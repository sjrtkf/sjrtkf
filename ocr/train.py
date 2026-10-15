"""Reproducible offline fine-tuning of the user's character classifier.

Only train/validation partitions are opened. Final-test evaluation belongs to a
separate command. Production model files are never replaced by this script.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import random
import sys
from time import perf_counter

import cv2
import numpy as np
import onnx
from onnx import numpy_helper
import onnxruntime as ort
import torch
from torch import nn
from torch.nn import functional as F

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ocr.core import Predictor
from ocr.compare_models import stress_images


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def arrays_from_onnx(path):
    graph = onnx.load(str(path))
    arrays = {x.name: numpy_helper.to_array(x).copy() for x in graph.graph.initializer}
    conv = [x for x in graph.graph.node if x.op_type == "Conv"]
    dense = [x for x in graph.graph.node if x.op_type == "MatMul"]
    if len(conv) != 2 or len(dense) != 2:
        raise ValueError("Expected the original two-convolution/two-dense model")
    names = []
    for node in conv:
        names.extend(node.input[1:3])
    for node in dense:
        add = next(x for x in graph.graph.node if x.op_type == "Add" and node.output[0] in x.input)
        bias = next(x for x in add.input if x in arrays)
        names.extend([node.input[1], bias])
    return graph, arrays, names


class CharacterModel(nn.Module):
    def __init__(self, arrays, names):
        super().__init__()
        c1, b1, c2, b2, d1, db1, d2, db2 = [arrays[x] for x in names]
        self.conv1 = nn.Conv2d(c1.shape[1], c1.shape[0], c1.shape[2:],padding=2)
        self.conv2 = nn.Conv2d(c2.shape[1], c2.shape[0], c2.shape[2:],padding=2)
        self.dense1 = nn.Linear(d1.shape[0], d1.shape[1])
        self.dense2 = nn.Linear(d2.shape[0], d2.shape[1])
        with torch.no_grad():
            for module, weight, bias in [(self.conv1,c1,b1),(self.conv2,c2,b2),
                                          (self.dense1,d1.T,db1),(self.dense2,d2.T,db2)]:
                module.weight.copy_(torch.from_numpy(weight))
                module.bias.copy_(torch.from_numpy(bias))

    def forward(self, x):
        x = F.max_pool2d(F.relu(self.conv1(x)), 2)
        x = F.max_pool2d(F.relu(self.conv2(x)), 2)
        # Keras Flatten preserves NHWC ordering; preserving it is essential.
        x = x.permute(0,2,3,1).reshape(x.shape[0], -1)
        return self.dense2(F.relu(self.dense1(x)))


def export_weights(model, graph, names, output):
    state = [model.conv1.weight, model.conv1.bias, model.conv2.weight, model.conv2.bias,
             model.dense1.weight.T, model.dense1.bias, model.dense2.weight.T, model.dense2.bias]
    replacements = {name: value.detach().cpu().numpy().copy() for name,value in zip(names,state)}
    for old in graph.graph.initializer:
        if old.name in replacements:
            old.CopyFrom(numpy_helper.from_array(replacements[old.name], old.name))
    onnx.checker.check_model(graph)
    onnx.save(graph, str(output))


def load_partition(split, partition, labels):
    if partition not in {"train", "validation"}:
        raise ValueError("Training must never open final-test images")
    root = Path(split["root"])
    records, crops, targets, failures = [], [], [], []
    for entry in split["items"]:
        if entry["split"] != partition:
            continue
        image_path = root / entry["path"]
        if sha256(image_path) != entry["hash"]:
            raise ValueError("Training image changed after frozen split")
        image = Predictor.read_image(image_path)
        mask, boxes = Predictor._segments(image, "filtered")
        if len(boxes) != 6:
            failures.append({"id":entry["id"],"detected":len(boxes)})
            continue
        start = len(crops)
        for char, (x,y,w,h) in zip(entry["label"], boxes):
            crops.append(cv2.resize(mask[y:y+h,x:x+w], (28,28)).astype(np.float32)/255.)
            targets.append(labels.index(char))
        records.append({"id":entry["id"], "label":entry["label"], "start":start,
                        "source_sha256":entry["hash"], "group_id":entry["group_id"]})
    return np.asarray(crops), np.asarray(targets,dtype=np.int64), records, failures


def transform(crop, *, angle=0., shear=0., width=1., height=1., thickness=0, noise=0., rng=None):
    """Distort foreground, then emulate the production crop/resize operation."""
    canvas = np.zeros((44,44), np.float32)
    canvas[8:36,8:36] = crop
    matrix = cv2.getRotationMatrix2D((21.5,21.5), float(angle), 1.)
    stretch = np.array([[width,shear,(1-width)*21.5-shear*21.5],
                        [0.,height,(1-height)*21.5],[0.,0.,1.]], np.float64)
    matrix = (np.vstack([matrix,[0.,0.,1.]]) @ stretch)[:2]
    result = cv2.warpAffine(canvas, matrix, (44,44), flags=cv2.INTER_LINEAR,
                            borderMode=cv2.BORDER_CONSTANT, borderValue=0.)
    kernel = cv2.getStructuringElement(cv2.MORPH_CROSS,(3,3))
    if thickness < 0:
        result = cv2.erode(result,kernel)
    elif thickness > 0:
        result = cv2.dilate(result,kernel)
    if noise and rng is not None:
        # Edge-local noise; no random detached components or synthetic labels.
        edge = (result > .05) & (result < .95)
        result[edge] += rng.normal(0.,noise,int(edge.sum()))
        result = np.clip(result,0.,1.)
    points = cv2.findNonZero((result > .35).astype(np.uint8))
    if points is None:
        return crop.copy()
    x,y,w,h = cv2.boundingRect(points)
    return cv2.resize(result[y:y+h,x:x+w],(28,28),interpolation=cv2.INTER_LINEAR)


def augment(crop, rng):
    if rng.random() < .35:
        return crop.copy()
    thickness = rng.choice([-1,0,1],p=[.13,.78,.09])
    return transform(crop,angle=rng.uniform(-12,12),shear=rng.uniform(-.22,.22),
                     width=rng.uniform(.82,1.15),height=rng.uniform(.91,1.09),
                     thickness=int(thickness),noise=.055,rng=rng)


def write_augmentation_montage(crops, targets, labels, output, seed):
    """Small diagnostic sample only; not extra labelled training data."""
    chosen = ["W","N","M","B","E","P","Q","R"]
    canvas = np.full((len(chosen)*82+35,7*82,3),255,np.uint8)
    rng=np.random.default_rng(seed+901)
    for row,char in enumerate(chosen):
        crop=crops[np.flatnonzero(targets==labels.index(char))[0]]
        samples=[crop]+[augment(crop,rng) for _ in range(5)]
        cv2.putText(canvas,char,(13,row*82+82),cv2.FONT_HERSHEY_SIMPLEX,1.,(0,0,0),2)
        for column,sample in enumerate(samples,1):
            gray=255-np.clip(cv2.resize(sample,(66,66))*255,0,255).astype(np.uint8)
            canvas[row*82+35:row*82+101,column*82:column*82+66]=gray[:,:,None]
    cv2.putText(canvas,"Original + 5 seeded training augmentations",(5,23),cv2.FONT_HERSHEY_SIMPLEX,.6,(0,0,0),1)
    encoded=cv2.imencode(".png",canvas)[1]
    Path(output).write_bytes(encoded.tobytes())


STRESS = [
    {"name":"rotate_plus_9","angle":9.},
    {"name":"rotate_minus_9","angle":-9.},
    {"name":"shear_plus_020","shear":.20},
    {"name":"shear_minus_020","shear":-.20},
    {"name":"thin_cross_3","thickness":-1},
    {"name":"thick_cross_3","thickness":1},
]


def stress_crops(crops):
    return np.stack([transform(crop,**{k:v for k,v in case.items() if k != "name"})
                     for case in STRESS for crop in crops])


def whole_image_validation(split, labels):
    crops, targets, records, failures = [], [], [], []
    for entry in split["items"]:
        if entry["split"] != "validation":
            continue
        image = Predictor.read_image(Path(split["root"]) / entry["path"])
        for variation, distorted in stress_images(image,entry["id"]):
            mask, boxes = Predictor._segments(distorted,"filtered")
            if len(boxes) != 6:
                failures.append({"id":entry["id"],"variation":variation,"detected":len(boxes)})
                continue
            for char,(x,y,w,h) in zip(entry["label"],boxes):
                crops.append(cv2.resize(mask[y:y+h,x:x+w],(28,28)).astype(np.float32)/255.)
                targets.append(labels.index(char))
            records.append({"id":entry["id"],"variation":variation})
    return np.asarray(crops),np.asarray(targets,dtype=np.int64),records,failures


def whole_image_training(split, labels, clean_records):
    """Keep labels attached to their source; reject uncertain contour alignment."""
    clean_by_id={record["id"]:record for record in clean_records}
    crops, targets, origins, kept, rejected = [], [], [], [], []
    for entry in split["items"]:
        if entry["split"] != "train" or entry["id"] not in clean_by_id:
            continue
        image=Predictor.read_image(Path(split["root"])/entry["path"])
        _,original_boxes=Predictor._segments(image,"filtered")
        original_geometry=np.array([((x+w/2)/image.width,(y+h/2)/image.height,
                                      w/image.width,h/image.height) for x,y,w,h in original_boxes])
        for variation,distorted in stress_images(image,entry["id"]):
            mask,boxes=Predictor._segments(distorted,"filtered")
            reason=None
            if len(boxes)!=6:
                reason="not_six_contours"
            else:
                geometry=np.array([((x+w/2)/distorted.width,(y+h/2)/distorted.height,
                                    w/distorted.width,h/distorted.height) for x,y,w,h in boxes])
                relative_size=geometry[:,2:]/original_geometry[:,2:]
                if (np.max(np.abs(geometry[:,0]-original_geometry[:,0]))>.055 or
                    np.max(np.abs(geometry[:,1]-original_geometry[:,1]))>.18 or
                    np.any(relative_size<.58) or np.any(relative_size>1.6)):
                    reason="uncertain_contour_alignment"
            if reason:
                rejected.append({"id":entry["id"],"variation":variation,"reason":reason})
                continue
            for position,(char,(x,y,w,h)) in enumerate(zip(entry["label"],boxes)):
                crops.append(cv2.resize(mask[y:y+h,x:x+w],(28,28)).astype(np.float32)/255.)
                targets.append(labels.index(char))
                origins.append(clean_by_id[entry["id"]]["start"]+position)
            kept.append({"id":entry["id"],"variation":variation,"group_id":entry["group_id"]})
    return np.asarray(crops),np.asarray(targets,dtype=np.int64),np.asarray(origins,dtype=np.int64),kept,rejected


def probabilities(model, crops):
    model.eval()
    with torch.no_grad():
        return np.concatenate([model(torch.from_numpy(chunk[:,None])).softmax(-1).numpy()
                               for chunk in np.array_split(crops,max(1,(len(crops)+255)//256))])


def metrics(probs, targets, labels, images, segmentation_failures=0):
    prediction = probs.argmax(1)
    good = prediction == targets
    accepted = probs.max(1) >= .75
    image_good = good.reshape(-1,6).all(1)
    image_accepted = accepted.reshape(-1,6).all(1)
    wn = np.isin(targets,[labels.index("W"),labels.index("N")])
    confusion = Counter(f"{labels[t]}->{labels[p]}" for t,p in zip(targets,prediction) if t != p)
    return {"characters":int(len(targets)+segmentation_failures*6),"correct_characters":int(good.sum()),
            "character_accuracy":float(good.sum()/max(1,len(targets)+segmentation_failures*6)),
            "images":images+segmentation_failures,"exact_images":int(good.reshape(-1,6).all(1).sum()),
            "exact_accuracy":float(good.reshape(-1,6).all(1).sum()/max(1,images+segmentation_failures)),
            "segmentation_failures":segmentation_failures,
            "wn_characters":int(wn.sum()),"wn_correct":int(good[wn].sum()),
            "wn_accuracy":float(good[wn].mean()) if wn.any() else None,
            "w_to_n":int(((targets==labels.index("W"))&(prediction==labels.index("N"))).sum()),
            "n_to_w":int(((targets==labels.index("N"))&(prediction==labels.index("W"))).sum()),
            "confusions":dict(confusion),
            "threshold_075":{"accepted_characters":int(accepted.sum()),
                             "accepted_wrong_characters":int((accepted&~good).sum()),
                             "accepted_images":int(image_accepted.sum()),
                             "accepted_wrong_images":int((image_accepted&~image_good).sum())},
            "mean_correct_class_probability":float(probs[np.arange(len(targets)),targets].mean())}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--split",default="work/ocr-training-v0.9.2/split.json")
    parser.add_argument("--model",default="ocr/models/captcha_solver.onnx")
    parser.add_argument("--labels",default="ocr/models/labels.json")
    parser.add_argument("--output",default="work/ocr-training-v0.9.2/train")
    parser.add_argument("--epochs",type=int,default=24)
    parser.add_argument("--seed",type=int,default=20261015)
    parser.add_argument("--learning-rate",type=float,default=.00008)
    parser.add_argument("--whole-training",action="store_true",help="Augment source images before production segmentation")
    args=parser.parse_args()
    output=Path(args.output);output.mkdir(parents=True,exist_ok=True)
    if (Path(args.model).resolve().parent == output.resolve()):
        raise ValueError("Candidates must be separate from the production model")
    random.seed(args.seed);np.random.seed(args.seed);torch.manual_seed(args.seed)
    torch.set_num_threads(4);torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)
    rng=np.random.default_rng(args.seed)
    split=json.loads(Path(args.split).read_text(encoding="utf-8"))
    group_partitions=defaultdict(set)
    for item in split["items"]:
        group_partitions[item["group_id"]].add(item["split"])
    if any(len(partitions)>1 for partitions in group_partitions.values()):
        raise ValueError("Source-image group leaks across partitions")
    labels=json.loads(Path(args.labels).read_text(encoding="utf-8"))["labels"]
    train_x,train_y,train_rows,train_fail=load_partition(split,"train",labels)
    val_x,val_y,val_rows,val_fail=load_partition(split,"validation",labels)
    write_augmentation_montage(train_x,train_y,labels,output/"augmentation-montage.png",args.seed)
    base_train_characters=len(train_y)
    train_origin=np.arange(base_train_characters,dtype=np.int64)
    whole_train_kept,whole_train_rejected=[],[]
    if args.whole_training:
        whole_train_x,whole_train_y,whole_origins,whole_train_kept,whole_train_rejected=whole_image_training(split,labels,train_rows)
        if len(whole_train_y):
            train_x=np.concatenate([train_x,whole_train_x]);train_y=np.concatenate([train_y,whole_train_y])
            train_origin=np.concatenate([train_origin,whole_origins])
    graph,arrays,names=arrays_from_onnx(args.model)
    model=CharacterModel(arrays,names)
    original={k:v.clone() for k,v in model.state_dict().items()}
    options=ort.SessionOptions();options.intra_op_num_threads=1;options.inter_op_num_threads=1
    session=ort.InferenceSession(str(args.model),sess_options=options,providers=["CPUExecutionProvider"])
    source_probs=session.run(None,{session.get_inputs()[0].name:val_x[...,None]})[0]
    torch_probs=probabilities(model,val_x)
    parity=float(np.max(np.abs(source_probs-torch_probs)))
    if parity>2e-5:
        raise ValueError(f"Imported weight parity failed: maximum delta {parity}")
    stress_x=stress_crops(val_x);stress_y=np.tile(val_y,len(STRESS))
    whole_x,whole_y,whole_rows,whole_fail=whole_image_validation(split,labels)
    base_clean=metrics(torch_probs,val_y,labels,len(val_rows),len(val_fail))
    base_stress=metrics(probabilities(model,stress_x),stress_y,labels,len(val_rows)*len(STRESS),len(val_fail)*len(STRESS))
    base_whole=metrics(probabilities(model,whole_x),whole_y,labels,len(whole_rows),len(whole_fail))
    clean_teacher=probabilities(model,train_x[:base_train_characters])
    counts=np.bincount(train_y,minlength=len(labels))
    weights=1./counts[train_y]
    if args.whole_training and len(train_y)>base_train_characters:
        base_counts=np.bincount(train_y[:base_train_characters],minlength=len(labels))
        whole_counts=np.bincount(train_y[base_train_characters:],minlength=len(labels))
        weights[:base_train_characters]=.4/base_counts[train_y[:base_train_characters]]
        weights[base_train_characters:]=.6/whole_counts[train_y[base_train_characters:]]
    weights/=weights.sum()
    optimizer=torch.optim.AdamW(model.parameters(),lr=args.learning_rate,weight_decay=.001)
    scheduler=torch.optim.lr_scheduler.CosineAnnealingLR(optimizer,T_max=args.epochs,eta_min=args.learning_rate*.15)
    history=[];best_score=(base_whole["correct_characters"],base_whole["exact_images"],base_whole["wn_correct"])
    best_epoch=0;best_state=original;started=perf_counter()
    print(json.dumps({"baseline_clean":base_clean,"baseline_stress":base_stress,"baseline_whole":base_whole,"import_parity_max_abs":parity}),flush=True)
    for epoch in range(1,args.epochs+1):
        model.train();losses=[]
        indices=rng.choice(len(train_x),size=base_train_characters*3,replace=True,p=weights)
        for offset in range(0,len(indices),96):
            picked=indices[offset:offset+96]
            batch=np.stack([augment(train_x[i],rng) for i in picked])
            x=torch.from_numpy(batch[:,None]);y=torch.from_numpy(train_y[picked])
            optimizer.zero_grad(set_to_none=True)
            logits=model(x)
            loss=F.cross_entropy(logits,y,label_smoothing=.015)
            # Keep clean predictions near the existing model while learning variants.
            clean=model(torch.from_numpy(train_x[train_origin[picked],None]))
            teacher=torch.from_numpy(clean_teacher[train_origin[picked]])
            loss=loss+.25*F.kl_div(F.log_softmax(clean,dim=1),teacher,reduction="batchmean")
            loss.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),2.);optimizer.step()
            losses.append(float(loss.detach()))
        scheduler.step()
        clean=metrics(probabilities(model,val_x),val_y,labels,len(val_rows),len(val_fail))
        stress=metrics(probabilities(model,stress_x),stress_y,labels,len(val_rows)*len(STRESS),len(val_fail)*len(STRESS))
        whole=metrics(probabilities(model,whole_x),whole_y,labels,len(whole_rows),len(whole_fail))
        eligible=(clean["exact_images"]>=base_clean["exact_images"] and
                  clean["correct_characters"]>=base_clean["correct_characters"] and
                  clean["wn_correct"]>=base_clean["wn_correct"] and
                  clean["threshold_075"]["accepted_images"]>=base_clean["threshold_075"]["accepted_images"] and
                  stress["correct_characters"]>=base_stress["correct_characters"] and
                  stress["threshold_075"]["accepted_wrong_images"]<=base_stress["threshold_075"]["accepted_wrong_images"] and
                  whole["threshold_075"]["accepted_wrong_images"]<=base_whole["threshold_075"]["accepted_wrong_images"] and
                  whole["threshold_075"]["accepted_wrong_images"]/max(1,whole["threshold_075"]["accepted_images"])<=
                  base_whole["threshold_075"]["accepted_wrong_images"]/max(1,base_whole["threshold_075"]["accepted_images"]) and
                  whole["wn_correct"]>=base_whole["wn_correct"] and
                  whole["w_to_n"]<=base_whole["w_to_n"] and
                  whole["n_to_w"]<=base_whole["n_to_w"])
        score=(whole["correct_characters"],whole["exact_images"],whole["wn_correct"])
        if eligible and score>best_score:
            best_score=score;best_epoch=epoch
            best_state={k:v.clone() for k,v in model.state_dict().items()}
        record={"epoch":epoch,"loss":float(np.mean(losses)),"validation_clean":clean,
                "validation_stress":stress,"validation_whole":whole,"eligible_clean_nonregression":eligible,"selected_so_far":best_epoch}
        history.append(record)
        print(json.dumps({"epoch":epoch,"loss":record["loss"],"clean_exact":clean["exact_images"],
                          "stress_correct":stress["correct_characters"],"stress_wn":stress["wn_correct"],
                          "whole_correct":whole["correct_characters"],"whole_exact":whole["exact_images"],"selected":best_epoch}),flush=True)
    model.load_state_dict(best_state)
    candidate=output/"captcha_solver.onnx"
    export_weights(model,graph,names,candidate)
    candidate_session=ort.InferenceSession(str(candidate),sess_options=options,providers=["CPUExecutionProvider"])
    final_probs=candidate_session.run(None,{candidate_session.get_inputs()[0].name:val_x[...,None]})[0]
    export_parity=float(np.max(np.abs(final_probs-probabilities(model,val_x))))
    if export_parity>2e-5:
        raise ValueError("Exported candidate differs from selected training state")
    np.savez_compressed(output/"validation-predictions.npz",expected=val_y,baseline=source_probs,candidate=final_probs,
                        stress_expected=stress_y,stress_baseline=probabilities(CharacterModel(arrays,names),stress_x),
                        stress_candidate=probabilities(model,stress_x),whole_expected=whole_y,
                        whole_baseline=probabilities(CharacterModel(arrays,names),whole_x),
                        whole_candidate=probabilities(model,whole_x))
    report={"seed":args.seed,"training_seconds":perf_counter()-started,"source_model_sha256":sha256(args.model),
            "candidate_sha256":sha256(candidate),"split_sha256":sha256(args.split),"selected_epoch":best_epoch,
            "improved_on_validation_stress":best_epoch>0,"epochs":args.epochs,"learning_rate":args.learning_rate,
            "training_code_sha256":sha256(__file__),"whole_stress_code_sha256":sha256(Path(__file__).with_name("compare_models.py")),
            "torch_version":torch.__version__,"onnx_version":onnx.__version__,"cpu_threads":4,
            "import_parity_max_abs":parity,"export_parity_max_abs":export_parity,
            "selection_rule":"No clean exact/character/WN/accepted coverage regression, crop-stress character regression, whole-image WN/W-to-N/N-to-W regression, or increase in accepted-wrong crop/whole stress images/rate at min-confidence .75; then maximize whole-image stress correct characters, exact images, WN correct (lexicographic)",
            "augmentation":{"clean_probability":.35,"rotation_degrees":[-12,12],"shear":[-.22,.22],
                            "width":[.82,1.15],"height":[.91,1.09],"thickness_probabilities":{"erode":.13,"unchanged":.78,"dilate":.09},
                            "edge_noise_std":.055,"sampling":"inverse class frequency, 3 draws per ORIGINAL training character per epoch", "label_smoothing":.015,
                            "clean_teacher_KL_weight":.25,"batch_size":96},
            "whole_image_training":{"enabled":args.whole_training,"original_pool_probability":.4 if args.whole_training else 1.,
                                    "augmented_pool_probability":.6 if args.whole_training else 0.,
                                    "kept_images":len(whole_train_kept),"kept_records":whole_train_kept,
                                    "rejected_images":len(whole_train_rejected),"rejected_records":whole_train_rejected,
                                    "alignment_guard":{"normalized_center_x_max_delta":.055,"normalized_center_y_max_delta":.18,"relative_size_range":[.58,1.6]},
                                    "transform_source":"ocr.compare_models.stress_images; train source images only"},
            "stress_transforms":STRESS,"train":{"images":len(train_rows),"original_characters":base_train_characters,
                                                  "characters_including_whole_augmentations":len(train_y),
                                                  "class_counts":dict(zip(labels,map(int,counts))),"segmentation_failures":train_fail},
            "validation":{"images":len(val_rows),"characters":len(val_y),"segmentation_failures":val_fail},
            "baseline_clean":base_clean,"baseline_stress":base_stress,"baseline_whole":base_whole,
            "candidate_clean":metrics(final_probs,val_y,labels,len(val_rows),len(val_fail)),
            "candidate_stress":metrics(probabilities(model,stress_x),stress_y,labels,len(val_rows)*len(STRESS),len(val_fail)*len(STRESS)),
            "candidate_whole":metrics(probabilities(model,whole_x),whole_y,labels,len(whole_rows),len(whole_fail)),
            "whole_validation_segmentation_failures":whole_fail,
            "training_records":train_rows,"validation_records":val_rows,"history":history,
            "limitations":split["limitations"]+[
                "Final-test files were not opened by training. Parent process performs final evaluation after candidate selection.",
                "Stress metrics describe six deterministic transformations of historical character crops, not live CAPTCHA success rates.",
                "No supplied current W/N failure example was available; class balance and augmentation cannot guarantee its correction."]}
    (output/"report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({k:report[k] for k in ["selected_epoch","candidate_sha256","candidate_clean","candidate_stress","training_seconds"]}),flush=True)


if __name__=="__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()

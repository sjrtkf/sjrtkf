const block={blockKey:'001:118',seats:Array.from({length:12},(_,i)=>({seatInfoId:`demo:${i+1}`,rowIdx:Math.floor(i/4),colIdx:i%4,rowNo:String(Math.floor(i/4)+1),seatNo:String(i%4+1),seatGrade:'R',seatGradeName:'3루 레드석',isExposable:true,seatGroupId:null}))};
module.exports=[block];

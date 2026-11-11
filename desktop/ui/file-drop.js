let reading=false;window.metisDropReady=true;
for(const name of ['dragenter','dragover'])document.addEventListener(name,event=>{event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='copy';});
document.addEventListener('drop',async event=>{
 event.preventDefault();if(reading)return;reading=true;
 try{
  const selected=Array.from(event.dataTransfer?.files||[]);
  if(!selected.length||selected.length>10||selected.reduce((sum,file)=>sum+file.size,0)>64*1024*1024)throw Error('Invalid file drop.');
  const point={x:event.clientX,y:event.clientY};
  const files=await Promise.all(selected.map(async file=>({name:file.name,lastModified:file.lastModified,bytes:new Uint8Array(await file.arrayBuffer())})));
  window.metisDrop.deliver({files,point});
 }catch{window.metisDrop.error();}
 finally{reading=false;}
});

const MAX_BYTES=64*1024*1024, MAX_MESSAGE=90*1024*1024;
function decodeDrop(value) {
 if(!value||!Array.isArray(value.files)||!value.files.length||value.files.length>10||!Number.isFinite(value.point?.x)||!Number.isFinite(value.point?.y))throw Error('Invalid file drop.');
 let total=0;
 const files=value.files.map(file=>{
  if(typeof file.name!=='string'||!file.name||file.name.length>255||/[\\/\0]/.test(file.name)||typeof file.data!=='string'||file.data.length>Math.ceil(MAX_BYTES/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(file.data))throw Error('Invalid dropped file.');
  const bytes=Buffer.from(file.data,'base64');total+=bytes.length;
  if(total>MAX_BYTES||bytes.toString('base64')!==file.data)throw Error('Dropped files exceed 64 MB.');
  return {name:file.name,bytes,lastModified:Number.isFinite(file.lastModified)?file.lastModified:0};
 });
 return {files,point:{x:value.point.x,y:value.point.y}};
}
function receiveLines(socket,callback,max=MAX_MESSAGE) {
 let chunks=[],length=0;
 socket.on('data',chunk=>{
  length+=chunk.length;if(length>max){socket.destroy();return;}chunks.push(chunk);
  if(!chunk.includes(10))return;
  const joined=Buffer.concat(chunks,length);let offset=0,index;
  while((index=joined.indexOf(10,offset))!==-1){
   try{callback(JSON.parse(joined.toString('utf8',offset,index)));}catch{socket.destroy();return;}
   offset=index+1;
  }
  const rest=joined.subarray(offset);chunks=rest.length?[rest]:[];length=rest.length;
 });
}
const send=(socket,value)=>{if(socket&&!socket.destroyed)socket.write(JSON.stringify(value)+'\n');};
module.exports={MAX_BYTES,decodeDrop,receiveLines,send};

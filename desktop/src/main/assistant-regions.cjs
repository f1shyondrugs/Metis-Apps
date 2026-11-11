function interactionRegions(value, bounds) {
  if (!value || !Number.isFinite(value.width) || !Number.isFinite(value.height) ||
      value.width <= 0 || value.height <= 0 || value.width > 100000 || value.height > 100000 ||
      !Array.isArray(value.rects) || value.rects.length > 4) throw new Error('Invalid assistant regions.');
  const sx = bounds.width / value.width, sy = bounds.height / value.height;
  return value.rects.map(rect => {
    if (!rect || !['x','y','width','height'].every(key => Number.isFinite(rect[key])) ||
        rect.width <= 0 || rect.height <= 0) throw new Error('Invalid assistant region.');
    const pad = 24;
    const x = Math.max(0, Math.floor((rect.x-pad)*sx)), y = Math.max(0, Math.floor((rect.y-pad)*sy));
    const right = Math.min(bounds.width, Math.ceil((rect.x+rect.width+pad)*sx));
    const bottom = Math.min(bounds.height, Math.ceil((rect.y+rect.height+pad)*sy));
    return {x,y,width:Math.max(0,right-x),height:Math.max(0,bottom-y)};
  }).filter(rect => rect.width && rect.height);
}
module.exports = { interactionRegions };

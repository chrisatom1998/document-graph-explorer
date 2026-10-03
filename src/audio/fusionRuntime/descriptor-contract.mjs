// Identity fields emitted by descriptionScores. Scores are deliberately excluded.
export function descriptorIdentity(d) {
  return [d.group,d.label,d.alternative??null,d.learnedGroup??null,d.decision??null];
}
export function promptDescriptorOrder(prompts) {
  if(!Array.isArray(prompts)||prompts.length!==512)throw Error('Invalid pinned prompt count');
  return prompts.map(p=>{
    if(typeof p.group!=='string'||!(p.label===null||typeof p.label==='string'))throw Error('Invalid pinned prompt identity');
    return [p.group,p.label,p.label===null&&p.prompt?p.prompt:null,null,null];
  });
}
export function verifyDescriptorOrder(descriptions,expected) {
  if(!Array.isArray(descriptions)||descriptions.length!==expected.length)throw Error('Descriptor width mismatch');
  for(let i=0;i<expected.length;i++){
    const d=descriptions[i];
    if(!Number.isFinite(d.score)||JSON.stringify(descriptorIdentity(d))!==JSON.stringify(expected[i]))throw Error('Ordered descriptor identity mismatch at '+i);
  }
}

/* KPS ERP Transaction Engine v4 */
window.KPSERP={
 submit(type,data,user){return this.create(type,data,user,'SUBMITTED')},
 create(type,data,user,status='DRAFT'){let r={id:crypto.randomUUID(),type,data,createdBy:user?.id||null,status,history:[{status,by:user?.id||'system',at:new Date().toISOString()}]};this.save(r);return r},
 save(r){let a=JSON.parse(localStorage.getItem('kps_records')||'[]');let i=a.findIndex(x=>x.id===r.id);i>=0?a[i]=r:a.push(r);localStorage.setItem('kps_records',JSON.stringify(a))},
 transition(id,status,user,comment=''){let a=JSON.parse(localStorage.getItem('kps_records')||'[]');let r=a.find(x=>x.id===id);if(!r)return null;r.status=status;r.history.push({status,by:user?.id||null,comment,at:new Date().toISOString()});this.save(r);return r},
 list(type){return JSON.parse(localStorage.getItem('kps_records')||'[]').filter(x=>!type||x.type===type)}
};

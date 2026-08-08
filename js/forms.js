window.KPSForms={
 create(type,data,creator){return {id:crypto.randomUUID(),type,data,status:'DRAFT',createdBy:creator,createdAt:new Date().toISOString()};},
 submit(f){return KPSWorkflow.submit(f)},
 approve(f,u){return KPSWorkflow.approve(f,u)},
 reject(f,u,r){return KPSWorkflow.reject(f,u,r)}
};

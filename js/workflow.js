/* KPS Workflow Engine
Statuses: DRAFT -> SUBMITTED -> REVIEW -> APPROVED/REJECTED -> LOCKED
*/
window.KPSWorkflow={
 submit(form){form.status="SUBMITTED";form.submittedAt=new Date().toISOString();return form;},
 review(form,reviewer){form.status="REVIEW";form.reviewer=reviewer;return form;},
 approve(form,approver){form.status="APPROVED";form.approvedBy=approver;return form;},
 reject(form,approver,reason){form.status="REJECTED";form.rejectedBy=approver;form.reason=reason;return form;},
 lock(form){form.status="LOCKED";return form;},
 canEdit(form,role){
   if(form.status==="LOCKED") return role==="super_admin";
   return true;
 }
};

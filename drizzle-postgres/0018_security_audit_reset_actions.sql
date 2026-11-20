ALTER TABLE "securityAudit" DROP CONSTRAINT security_audit_action;
--> statement-breakpoint
ALTER TABLE "securityAudit" ADD CONSTRAINT security_audit_action CHECK(action IN ('password_verified','mfa_verified','mfa_enabled','mfa_disabled','recovery_acknowledged','recovery_regenerated','policy_enabled','policy_disabled','session_revoked','other_sessions_revoked','platform_backup_created','business_export_created','member_permissions_changed','configuration_changed','password_reset_link_created','password_reset_completed'));

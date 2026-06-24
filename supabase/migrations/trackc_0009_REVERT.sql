-- Revert Track C C9: drop the access-requests table + helper.
begin;
drop table if exists access_requests;
drop function if exists ar_normalize_email();
commit;

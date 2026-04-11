-- nuevadb.sql requires explicit table-level REVOKE for anon and authenticated.
REVOKE ALL ON public.webhook_events FROM anon, authenticated;
REVOKE ALL ON public.job_locks      FROM anon, authenticated;;

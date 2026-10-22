-- The profile trigger runs with elevated rights; it must never be callable through the API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

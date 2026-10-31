Upstream OpenBot workflows, moved out of `.github/workflows/` so they never run in this personal
fork (they need upstream secrets/environments and would fail or burn Actions minutes).
The only active workflow is `.github/workflows/android-local.yml`.
Move a file back into `.github/workflows/` to re-enable it.

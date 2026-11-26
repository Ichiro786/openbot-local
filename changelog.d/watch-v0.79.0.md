### Changed

- Engine: rebase the six local patches onto upstream 0.79.0. No new protocol-9 capability: the baseline stays exactly 256 and the full list is 312, so the 256 wire limit holds. The WhatsApp alias stays out of the capability lists (PR #19).
- Engine: start the D-Bus session and both virtual displays at the same time, and check each display socket before each display probe. Cold start is faster.
- Engine: pack the two rootfs archives one after the other, so peak build memory drops.
- Engine: while the phone server rests with no turn running, the resource sampler stops its 60-second timer (it starts again at the next turn), the memory guard scans /proc at most once a minute unless memory is short, and the sign-in file check runs every 30 seconds instead of every 2 seconds. The phone test still has to measure the idle power saving.
- Upstream 0.79.0: the main process does less work on busy servers; chat updates that a later update replaces are deleted, so the database stops growing; a provider CLI that does not answer no longer blocks start for 2 minutes.

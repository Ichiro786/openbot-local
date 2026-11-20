### Fixed

- The app no longer stops when a chat shows the actions under a message. Before, the action row called a copy function that the 1.4.11 import had removed.
- Android chats with ColorOS motion on show each streamed reply update at once again. Before, the chat held updates and combined them once per animation frame. This change was part of the set that showed a black screen on scroll and when a chat opens.
- A message that waited to send (offline, held or retried) now fades to full colour when the server confirms it. Before, it changed from dim to full colour at once and its entrance animation could play a second time, so it looked like a second send.

### Changed

- A new reaction on a message now grows into place with a short spring. Reactions that are already on a message do not move when the chat opens or scrolls.
- The Copy button of a code block now changes to the check mark with a short spring, as the Copy button of a message does.

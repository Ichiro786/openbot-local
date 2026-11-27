### Fixed

- Make mobile chat close travel use one forward critical curve. Keep the chat content visible during the close.
- Keep the hidden close avatar idle without changing custom avatar images.
- Pause covered mobile chat blurs. Stop the Android header blur when its screen closes, and resume chat frost on focus.
- Extend the mobile chat header blur across the button and name row. Keep the dim gradient unchanged. Dark and light screenshots need approval before shipping.
- Make the mobile chat glide while a reply streams. The list keeps the end without new scroll animations, and a short shift on the UI thread smooths each new line.
- Show mobile reply words in small steps every 50 ms. A long tail at the end of a reply now plays in 350 ms, not in one frame.
- With ColorOS motion on Android, hold a mobile chat on its skeleton while it gets the latest messages, until the list settles at the end, for at most 1200 ms. The chat stays at the latest message until you drag, scroll away or send.
- On Android, when you send in an agent chat, the keyboard stays open and cannot type the last word of the sent message into the empty field again. This change needs a new app build.
- With ColorOS motion on, a mobile chat composer resize (a line wrap, a reply bar, an attachment, a send) sets the list end space one time, not on each frame. A short shift on the UI thread keeps the latest message above the composer while the composer moves.
- With ColorOS motion on Android, a send in a mobile chat uses one scroll owner. At the end, the list keeps the end and glides the new message on the UI thread, with no scroll animation. Above the end, the list scrolls to the end one time. The composer shrinks in the same frame as the send.

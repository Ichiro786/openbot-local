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
- With ColorOS motion on Android, a reaction that you pick in the message menu (the quick bar or the full emoji grid) shows on the message at the tap, while the menu fades. You feel one haptic tick, not two. If the reaction fails, the error dialog opens after the menu closes.
- With ColorOS motion on Android, adding or removing a reaction no longer makes the chat jump. On your own messages, reactions show in a small pill on the bottom corner of the bubble, and the row height stays the same. On agent messages, Copy, Read aloud and the time slide to their new place, and a removed reaction shrinks away. With motion off, the change is instant.
- With ColorOS motion on Android, home runs at most two blurs. The search field and the edge blur stay frosted. The top bar shows a solid surface when you scroll, and does not blur. The field, the edge, the top bar and the search results pause under a frosted menu or dialog and while a chat covers home. The field and the edge also pause while the server drawer is open. With motion off, the top bar keeps its blur.
- On Android, the header blur fade no longer redraws its mask on each frame. When the header blur cannot run, the header shows a solid surface, not a see-through tint. A short bounce at the top of the list does not stop and start the blur again.

### Fixed

- On Android with ColorOS motion on, closing an agent chat now measures the agent's real home avatar blob (both pinned top-row blobs and left-edge list-row blobs) and lands the morphing blob directly on top of it at the exact center and size. Before, the close targeted the full row or tile rect, shrank the avatar too small inside a colored ring, and faded out before arriving.

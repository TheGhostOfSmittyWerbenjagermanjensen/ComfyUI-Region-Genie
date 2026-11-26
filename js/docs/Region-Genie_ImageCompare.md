# Image Compare (Region Genie)

Shows two or more images in one node to compare them.

- **Inputs:** `image_1`, `image_2`, …; a free input is added when the last one gets a cable. Every image of a batch is a picture of its own. The pictures are numbered in input order.
- **Slider:** with the pointer on the picture, the picture before the chosen one is left of the pointer and the chosen one right of it. Off the picture, the chosen one shows whole. The last picture is chosen to start with.
- **Keys**, while the pointer is over the node: `1` to `9` (number row or numpad) choose a picture; the left / right arrow keys step to the one before / after.
- **Buttons, top right:** *around the corner* (picture 1 has the last picture on its left; off: it shows alone) and *number labels*.
- **Hide a picture:** right-click its number. Its neighbours are then compared with each other; right-click again, or click, to show it.

With two pictures it reads 1 | 2; pressing `1` swaps the sides.

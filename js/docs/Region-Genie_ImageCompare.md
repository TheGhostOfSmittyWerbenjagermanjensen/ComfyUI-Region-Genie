# Image Compare (Region Genie)

Shows two or more images in one node to compare them.

- **Inputs:** `image_1`, `image_2`, …; a free input is added when the last one gets a cable. Every image of a batch is a picture of its own. The pictures are numbered in input order.
- **Slider:** with the pointer on the picture, the picture before the chosen one is left of the pointer and the chosen one right of it. Off the picture, the chosen one shows whole. The last picture is the chosen one after every run.
- **Keys**, while the pointer is anywhere over the node: `1` to `9` (number row or numpad) choose a picture; the left / right arrow keys step to the one before / after (change these two under Settings > Region Genie > Shortcuts, section *Image Compare node*).
- **Buttons, top right:** *Loop* (picture 1 has the last picture on its left; off: it shows alone) and *number labels*.
- **Looking closer:** the wheel over the node zooms the graph and a middle-button drag moves it, as usual. The third button (or `Alt+Enter`) opens the **Large view**: there the wheel zooms into the pictures (out as far as the whole picture fits) and a drag (left or middle button) moves them; Esc closes it.
- **Hide a picture:** right-click its number. Its neighbours are then compared with each other; right-click again, or click, to show it.

With two pictures it reads 1 | 2; pressing `1` swaps the sides.

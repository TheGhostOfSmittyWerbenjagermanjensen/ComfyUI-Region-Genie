# Security

## Reporting a vulnerability

Please report security problems **privately**, not in a public issue:

1. Open the repository's [Security tab](https://github.com/TheGhostOfSmittyWerbenjagermanjensen/ComfyUI-Region-Genie/security).
2. Click **Report a vulnerability**.
3. Describe the problem. The report reaches only the maintainer.

A useful report says:

- What an attacker could do, and what they need for it (for example a crafted workflow file, or access to the ComfyUI server).
- The steps to reproduce it, with the smallest workflow or request that shows it.
- The versions: Region Genie (the badge at the top of the README), ComfyUI and its frontend.

This is a one-person project, so there is no guaranteed response time. Reports are read, and a fix or an answer follows as soon as it can.

## Supported versions

Only the latest version gets fixes. Please check that the problem still exists there before you report it.

## What counts

Region Genie runs inside ComfyUI, on the same machine and with the same rights. Things worth reporting:

- A workflow file or an image that makes the pack run code, or read or write files outside the folders it is meant to use.
- A request to one of the pack's server routes (`/region_genie/...`) that does the same.
- A secret or a personal file path that ends up in a saved image or workflow without the user having asked for it.

Not in scope: problems in ComfyUI itself, in other custom nodes or in model files. Please report those to their own projects.

# Obsync (Obsidian Sync)

A lightweight Obsidian plugin designed to synchronize your vault with remote repositories. Unlike other sync plugins, Obsync communicates directly with provider APIs, meaning no local Git installation is required. This makes it fast, mobile-friendly, and independent of system-level dependencies.

## Features

- Seamlessly connect and switch between different remote Git providers.
- Syncs all file types, including images, PDFs, and attachments alongside your Markdown notes.
- Works entirely via REST APIs without needing Git installed on your device.
- Safely detects file changes before pushing or pulling to prevent data loss.
- Bypasses typical browser security blocks to easily connect with self-hosted servers.

## Configuration

To get started, open the plugin settings and configure your upstream provider:

- **Upstream:** Choose your preferred provider.
- **URL:** The base URL if using a self-hosted instance.
- **Owner:** Your username or organization name.
- **Repository:** The name of the repository (the plugin will auto-initialize if it does not exist).
- **Access Token:** A Personal Access Token (PAT) with repository read and write scopes.

## Contributing

This project is in active development. If you encounter a bug or have a feature request, please open an issue or submit a PR. 

*Security Note: Never share your plugin data.json file with anyone, as it contains your private access tokens.*

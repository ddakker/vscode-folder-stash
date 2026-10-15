# Folder Stash

**Close and reopen sub directories like Eclipse's Close Project — closed ones disappear from search too.**

> [한국어](README_ko.md)

When you keep several git worktrees (or modules) under one opened folder, every search hits all of them:
Find in Files, Quick Open and Go to Symbol return the same class from every worktree.
Search filters work, but typing them every time is tedious.

Folder Stash lets you **close** the directories you are not working on, and **reopen** them in one click.

![How it works](images/flow-en.png)

## Close a directory

Right-click one or more directories in the Explorer → **Temporarily Close Directory**.

![Explorer context menu](images/close-en.png)

## Reopen

Right-click anywhere in the Explorer, or run from the Command Palette → **Reopen Closed Directory**.
Check the directories to reopen and press Enter.

![Reopen picker](images/reopen-en.png)

- 📂 button (Reopen now): reopen just that directory immediately
- `(missing)`: the directory was deleted from disk (clean up with 📂)

## Where closed directories disappear

| Feature | How |
|---|---|
| Explorer, Find in Files (Ctrl+Shift+F), Quick Open (Ctrl+P) | `files.exclude` (folder setting) |
| Go to Symbol in Workspace (Ctrl+T), Go to Definition (Java) | `java.import.exclusions` (only when the Java extension is installed) |

- Settings are saved in `.vscode/settings.json`. Only entries added by this extension are added or removed;
  your own entries are kept.
- When the Java exclusion list changes, a **Reload** notification appears.
  - On close: `Java: Clean Java Language Server Workspace` (needed to drop already imported projects)
  - On reopen: `Java: Import Java projects in workspace`
- If you turn off **Use Exclude Settings and Ignore Files** (gear icon) in Find in Files,
  closed directories are searched again.

## Settings

| Setting | Default | Description |
|---|---|---|
| `folderStash.excludeFromJava` | `true` | Also exclude closed directories from Java project import |

## Behavior

- The closed list is stored per folder in VS Code's workspace storage.
- If you delete an entry from `files.exclude` in `.vscode/settings.json` yourself, it is treated as reopened
  and removed from the list and from the Java exclusions.
- Paths you already put in `files.exclude` yourself are skipped, so reopening never removes your own entries.
- Changes to the user-level `java.import.exclusions` are not applied to this folder until everything is reopened.
- If `.vscode/settings.json` is tracked by git, closing a directory modifies that file
  (and writes absolute paths to `java.import.exclusions`). Don't commit it, or add the file to `.gitignore`.
- If you edit a `files.exclude` entry to `false` or a `when` clause, it is treated as reopened and left as you wrote it.

## Build / Install

```bash
./package.sh      # npm install (first time) + type check + tests + vsix
./install.sh      # package and install into VS Code
```

## License

Apache-2.0

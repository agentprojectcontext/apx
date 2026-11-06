// Settings › Storage: loaded with it (usePack in index.ts). The corner card's strings stay in en.ts.
export const enStorage = {
  "storage.lead": "What APX keeps on this computer, and room you can get back.",
  "storage.disk": "Disk",
  "storage.diskFree": "{free} free of {total}",
  "storage.diskLow": "Your disk is almost full. When it runs out, APX can't save chats or files.",
  "storage.apx": "APX uses",
  "storage.measuring": "Measuring…",
  "storage.partial": "At least this much: there was too much to count it all.",
  "storage.free": "Free up space",
  "storage.freeHint":
    "Removes caches and old logs that APX makes again when it needs them. Your chats, memory, files, projects and backups stay.",
  "storage.freeCta": "Free up {size}",
  "storage.nothing": "Nothing to free up",
  "storage.freed": "Freed {size}.",
  "storage.failed": "Could not free up space: {error}",
  "storage.unavailable": "Could not read storage: {error}",
  "storage.delete": "Delete",
  "storage.deleteFailed": "Could not delete it: {error}",
  "storage.computers.agents": "Your agents' computer",
  "storage.computers.lab": "Test computer left over: {name}",
  "storage.computers.on": "On",
  "storage.computers.off": "Off",
  "storage.computers.lastUse": "used {when}",
  "storage.computers.offFirst": "Turn it off to delete it.",
  "storage.computers.turnOff": "Turn off",
  "storage.computers.turnOffFailed": "Could not turn it off: {error}",
  "storage.computers.empty": "There are no agents' computers on this disk.",
  "storage.computers.confirmAgentsTitle": "Delete your agents' computer?",
  "storage.computers.confirmLabTitle": "Delete the test computer {name}?",
  "storage.computers.confirmAgents":
    "Everything your agents installed or saved inside it is lost, and {size} are freed. It is set up again from scratch the next time an agent needs it.",
  "storage.computers.confirmLab":
    "Everything installed or saved inside it is lost, and {size} are freed. A test left it here; APX does not use it.",
  "storage.computers.deleted": "Computer deleted. Freed {size}.",
  "storage.backups.empty": "There are no backups.",
  "storage.backups.confirmTitle": "Delete the backup from {date}?",
  "storage.backups.confirmBody":
    "This copy of your chats, memory and tasks is deleted for good, and {size} are freed. What APX has now stays as it is.",
  "storage.backups.deleted": "Backup deleted. Freed {size}.",
  "storage.compact.title": "Shrink the chats' file",
  "storage.compact.hint":
    "Old command and file output your agents no longer read is kept as a short note, and the file gives the space back. A copy is saved in Backups first.",
  "storage.compact.cta": "Compact",
  "storage.compact.confirmTitle": "Compact the chats' file?",
  "storage.compact.confirmBody":
    "Chats and routines wait until it ends, from a few seconds to a few minutes. A copy of the file is saved in Backups first; delete it here when you no longer need it.",
  "storage.compact.done": "Compacted: {before} → {after}. A copy was saved in Backups.",
  "storage.compact.keptSize":
    "Compacted, but the file keeps its size until the disk has room to rewrite it. A copy was saved in Backups.",
  "storage.compact.noRoom":
    "Nothing changed: the disk has no room for a copy of the file and its rewrite. Free up some space and try again.",
  "storage.compact.failed": "Could not compact: {error}",
};

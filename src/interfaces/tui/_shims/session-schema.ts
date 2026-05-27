let _msgCounter = 0
let _partCounter = 0
let _sidCounter = 0

export const MessageID = {
  ascending: () => `msg-${Date.now()}-${_msgCounter++}`,
}

export const PartID = {
  ascending: () => `part-${Date.now()}-${_partCounter++}`,
}

export const SessionID = {
  ascending: () => `sid-${Date.now()}-${_sidCounter++}`,
}

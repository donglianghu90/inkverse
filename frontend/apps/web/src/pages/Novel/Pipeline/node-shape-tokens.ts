export const NODE_SIZE = {
  agentNode: { w: 256, h: 120 },
  conditionNode: { w: 200, h: 112 },
  checkNode: { w: 224, h: 80 },
  parallelFork: { w: 240, h: 52 },
  parallelJoin: { w: 240, h: 52 },
  loopEntry: { w: 240, h: 72 },
  loopExit: { w: 240, h: 34 },
  phaseHeader: { w: 220, h: 38 },
} as const;

export const HANDLE_CLS = {
  top: '!w-3 !h-3 !border-2 !border-background',
  side: '!w-2.5 !h-2.5 !border-2 !border-background',
  hidden: '!w-0 !h-0 !opacity-0 !border-0 !min-w-0 !min-h-0',
} as const;

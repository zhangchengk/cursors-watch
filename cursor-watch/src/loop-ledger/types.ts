export interface LoopLedgerEntry {
  conversationId: string;
  seenAt: number;
  commandFingerprint: string;
  markedConversationId?: string;
}

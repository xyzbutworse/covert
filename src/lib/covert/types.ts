export type TxState = "idle" | "pending" | "success" | "error";
export type TxReceipt = { state: TxState; title?: string; hash?: string; detail?: string };

export type LocalPolicyKey = {
  commitment: string;
  privateKey: string;
  publicKey: string;
  salt: string;
  tier: number;
  createdAt: number;
};

export type ClaimDraft = {
  policyCommitment: string;
  claimCommitment: string;
  incidentHash: string;
  incidentSalt: string;
  incidentText: string;
  createdAt: number;
  submitTx?: string;
  decisionTx?: string;
};

export type UsageInput = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
};

export type UsageBucket = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  requests: number;
};

export type JobUsage = {
  byRole: Record<string, UsageBucket>;
  byModel: Record<string, UsageBucket>;
  total: UsageBucket;
};

function emptyBucket(): UsageBucket {
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    requests: 0,
  };
}

function accumulateBucket(bucket: UsageBucket, usage: UsageInput): void {
  bucket.inputTokens += usage.inputTokens;
  bucket.outputTokens += usage.outputTokens;
  bucket.reasoningTokens += usage.reasoningTokens;
  bucket.cachedTokens += usage.cachedTokens;
  bucket.requests += 1;
}

function formatBucketLine(label: string, bucket: UsageBucket): string {
  const n = (v: number) => v.toLocaleString("en-US");

  const parts: string[] = [
    `input=${n(bucket.inputTokens)}`,
    `output=${n(bucket.outputTokens)}`,
  ];

  if (bucket.reasoningTokens > 0) {
    parts.push(`reasoning=${n(bucket.reasoningTokens)}`);
  }
  if (bucket.cachedTokens > 0) {
    parts.push(`cached=${n(bucket.cachedTokens)}`);
  }

  parts.push(`(${n(bucket.requests)} reqs)`);

  return `  ${label}:  ${parts.join("  ")}`;
}

export class UsageTracker {
  private _byRole: Record<string, UsageBucket> = {};
  private _byModel: Record<string, UsageBucket> = {};
  private _total: UsageBucket = emptyBucket();

  add(role: string, model: string, usage: UsageInput): void {
    if (!this._byRole[role]) {
      this._byRole[role] = emptyBucket();
    }
    if (!this._byModel[model]) {
      this._byModel[model] = emptyBucket();
    }

    accumulateBucket(this._byRole[role], usage);
    accumulateBucket(this._byModel[model], usage);
    accumulateBucket(this._total, usage);
  }

  getUsage(): JobUsage {
    return {
      byRole: { ...this._byRole },
      byModel: { ...this._byModel },
      total: { ...this._total },
    };
  }

  toJSON(): string {
    return JSON.stringify(this.getUsage(), null, 2);
  }

  formatDisplay(): string {
    const lines: string[] = ["Token 用量:"];

    for (const [model, bucket] of Object.entries(this._byModel)) {
      lines.push(formatBucketLine(model, bucket));
    }

    lines.push(formatBucketLine("总计", this._total));

    return lines.join("\n");
  }
}

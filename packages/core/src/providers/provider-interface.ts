export interface ProviderAdapter {
  readonly providerId: string;
  readonly displayName: string;
  probe(apiKey: string, baseUrl?: string): Promise<boolean>;
}

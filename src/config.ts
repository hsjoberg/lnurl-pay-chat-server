export const config: IConfig = {
  host: "192.168.1.111:8087",
  url: "http://192.168.1.111:8087",
  lightningAddress: "chat@blixtwallet.com",
}

export interface IConfig {
  // Listening host (i.e 192.168.1.1:8080)
  host: string;
  // URL to the site (i.e https://domain.com)
  url: string;
  // Lightning Address (i.e chat@domain.com) that goes to the
  // LNURL-pay endpoint <config.url>/api/send-text
  lightningAddress: string | null;
}

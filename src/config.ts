export const config: IConfig = {
  host: "192.168.1.1:8080",
  url: "http://192.168.1.1:8080",
}

export interface IConfig {
  // Listening host (i.e 192.168.1.1:8080)
  host: string;
  // URL to the site (i.e https://domain.com)
  url: string;
}

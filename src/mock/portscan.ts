import type { HostScanResult } from "@/models/portscan";

/** The full simulated LAN used by the IP / Port Scanner demo. Hosts are
 * revealed progressively by useSimulatedProgress as the "scan" runs. */
export const mockHosts: HostScanResult[] = [
  {
    id: "h1",
    ip: "192.168.1.1",
    hostname: "router",
    status: "up",
    mac: "B8:27:EB:4A:11:02",
    vendor: "MikroTik",
    responseTimeMs: 1,
    ports: [
      { port: 53, service: "DNS", banner: "(MikroTik)" },
      { port: 80, service: "HTTP", banner: "MikroTik RouterOS 7.14" },
    ],
  },
  {
    id: "h2",
    ip: "192.168.1.10",
    hostname: "pc-jonas",
    status: "up",
    mac: "3C:52:82:7A:9E:11",
    vendor: "Dell Inc.",
    responseTimeMs: 2,
    ports: [
      { port: 135, service: "MSRPC", banner: "Microsoft Windows RPC" },
      { port: 445, service: "SMB", banner: "Windows 11 Pro 10.0.22631" },
    ],
  },
  {
    id: "h3",
    ip: "192.168.1.20",
    hostname: "fileserver",
    status: "up",
    mac: "00:15:5D:01:23:45",
    vendor: "Microsoft Corporation",
    responseTimeMs: 2,
    ports: [
      { port: 22, service: "SSH", banner: "OpenSSH 9.2p1" },
      { port: 445, service: "SMB", banner: "Windows Server 2022" },
    ],
  },
  {
    id: "h4",
    ip: "192.168.1.25",
    hostname: "printer",
    status: "up",
    mac: "3C:D9:2B:11:8A:04",
    vendor: "HP Inc.",
    responseTimeMs: 4,
    ports: [{ port: 80, service: "HTTP", banner: "HP Embedded Web Server" }],
  },
  {
    id: "h5",
    ip: "192.168.1.30",
    hostname: "nas-synology",
    status: "up",
    mac: "00:11:32:9C:44:7B",
    vendor: "Synology Inc.",
    responseTimeMs: 3,
    ports: [
      { port: 5000, service: "HTTP", banner: "Synology DiskStation" },
      { port: 5001, service: "HTTPS", banner: "Synology DiskStation" },
    ],
  },
  {
    id: "h6",
    ip: "192.168.1.50",
    hostname: "camera-01",
    status: "up",
    mac: "A4:14:37:65:22:19",
    vendor: "Hikvision",
    responseTimeMs: 6,
    ports: [{ port: 554, service: "RTSP", banner: "Hikvision IP Camera" }],
  },
  {
    id: "h7",
    ip: "192.168.1.95",
    hostname: "unknown",
    status: "up",
    mac: "5C:E0:C5:88:AB:2E",
    vendor: "Unknown",
    responseTimeMs: 5,
    ports: [{ port: 3389, service: "RDP", banner: "Microsoft Terminal Services" }],
  },
  {
    id: "h8",
    ip: "192.168.1.100",
    hostname: "webserver",
    status: "up",
    mac: "00:0C:29:4F:6A:18",
    vendor: "VMware Inc.",
    responseTimeMs: 2,
    ports: [
      { port: 80, service: "HTTP", banner: "nginx 1.24.0" },
      { port: 443, service: "HTTPS", banner: "nginx 1.24.0" },
    ],
  },
];

export const commonPortsTop100 = "7,20-23,25,53,67-69,80,88,110,111,123,135,137-139,143,161-162,389,443,445,465,514,515,548,554,587,631,636,993,995,1080,1194,1433,1521,1723,2049,2082,2083,2181,2375,3000,3268,3306,3389,3690,4443,5000,5001,5432,5900,5985,5986,6379,6443,8000,8008,8080,8081,8443,8888,9000,9090,9200,9418,27017";

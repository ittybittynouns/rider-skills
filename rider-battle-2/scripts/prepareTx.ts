const to = args.to;
const data = args.data || "0x";
const value = args.value || "0x0";
const label = args.label || "Bankr CryptoRider";
if (!to) { return { error: "missing 'to' address" }; }
const button = await bankr.tx.prepare({ chain: "base", to: to, data: data, value: value, label: label });
return { button: button };

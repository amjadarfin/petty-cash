export default function ReportMeta({ fyName, filters }: { fyName: string; filters?: string }) {
  const now = new Date();
  return (
    <div className="banner banner-info" style={{ fontSize: 11.5 }}>
      Generated {now.toLocaleDateString("en-GB")} {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
      {" · "}Fiscal Year: {fyName}
      {filters ? ` · Filters: ${filters}` : " · Filters: none"}
    </div>
  );
}

import TransferWorkspace from "@/modules/transfer/components/TransferWorkspace";

export default async function TransferPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TransferWorkspace sessionId={id} />;
}

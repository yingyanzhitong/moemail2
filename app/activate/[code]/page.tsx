import { ActivationBridge } from './activation-bridge'

export const runtime = 'edge'

export default async function ActivationPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return <ActivationBridge code={code} />
}

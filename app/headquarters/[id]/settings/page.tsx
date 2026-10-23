import { OrganizationSettings } from '@/components/headquarters/OrganizationSettings'
import { AgentAutonomySettings } from '@/components/headquarters/AgentAutonomySettings'
import { Container } from '@/components/Container'

export const metadata = {
  title: 'Settings - AI Headquarters',
  description: 'Organization settings',
}

export default function SettingsPage() {
  return (
    <>
      <OrganizationSettings />
      <Container className="pb-12">
        <AgentAutonomySettings />
      </Container>
    </>
  )
}

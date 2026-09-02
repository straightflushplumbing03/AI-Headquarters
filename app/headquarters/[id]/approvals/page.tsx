import { ApprovalCenter } from '@/components/headquarters/ApprovalCenter'
import { Sprint3ApprovalCenter } from '@/components/sprint3/Sprint3ApprovalCenter'

export const metadata = {
  title: 'Approvals - AI Headquarters',
  description: 'Approval center for AI-proposed decisions and actions',
}

export default function ApprovalsPage() {
  return (
    <div className="space-y-12">
      {/* Sprint 3: autonomous decision approvals (approval_requests table) */}
      <Sprint3ApprovalCenter />

      {/* Legacy task approvals (tasks table) */}
      <ApprovalCenter />
    </div>
  )
}

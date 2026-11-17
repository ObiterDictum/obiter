import type { IntegrationMarkKey } from './integration-marks'

export type IntegrationGroupId =
  | 'team-chat'
  | 'email-calendar'
  | 'documents'
  | 'practice'
  | 'signing'
  | 'public-sources'

export interface IntegrationGroup {
  id: IntegrationGroupId
  title: string
}

export const INTEGRATION_GROUPS: readonly IntegrationGroup[] = [
  { id: 'team-chat', title: 'Team chat' },
  { id: 'email-calendar', title: 'Email and calendar' },
  { id: 'documents', title: 'Documents and storage' },
  { id: 'practice', title: 'Practice management' },
  { id: 'signing', title: 'Signing' },
  { id: 'public-sources', title: 'Public sources' },
]

export interface IntegrationCapability {
  title: string
  description: string
}

export type IntegrationVisual =
  | { kind: 'mark'; key: IntegrationMarkKey }
  | { kind: 'lettermark'; letters: string; hex: string }

export type IntegrationLifecycle = 'available' | 'planned'
export type IntegrationStatus = 'connected' | IntegrationLifecycle | 'checking'

export interface Integration {
  id: string
  name: string
  group: IntegrationGroupId
  status: IntegrationLifecycle
  summary: string
  description: string
  visual: IntegrationVisual
  capabilities: readonly IntegrationCapability[]
  dataLeaves: string
}

const capabilities = (
  ...rows: readonly (readonly [string, string])[]
): IntegrationCapability[] =>
  rows.map(([title, description]) => ({ title, description }))

const CHAT = [
  ['Read channels it is added to', 'Only channels it is invited to.'],
  ['Answer when mentioned', 'Reply in the thread that asks.'],
  ['Post matter updates', 'Say where a matter has got to.'],
  ['Send direct messages', 'Message someone who must decide.'],
] as const

const CALENDAR = [
  ['Read the diary', 'See hearings, meetings and deadlines.'],
  ['Find time', 'Suggest slots that fit everyone.'],
  ['Add deadlines', 'Put a court or filing date in the diary.'],
] as const

const STORAGE = [
  ['Read files in chosen folders', 'Only the folders you pick.'],
  ['Save drafts back', 'Write the documents it produces.'],
  ['Index for search', 'Make the folder searchable in Obiter.'],
] as const

const PRACTICE = [
  ['Read matters and clients', 'Look up the matter and client record.'],
  ['Log time entries', 'Record time against the right matter.'],
  ['Create tasks', 'Add a task with a person and a date.'],
] as const

const SIGNING = [
  ['Prepare envelopes', 'Assemble the documents and signers.'],
  ['Track signature status', 'Say who has signed and who has not.'],
] as const

export const INTEGRATIONS: readonly Integration[] = [
  {
    id: 'buzz',
    name: 'Buzz',
    group: 'team-chat',
    status: 'available',
    summary: "Reach the team in Obiter's own Buzz workspace.",
    description:
      'Buzz is the team’s own workspace. Link your key and the agent works in the channels and direct messages your Buzz roles unlock.',
    visual: { kind: 'lettermark', letters: 'B', hex: '#6E56A8' },
    capabilities: capabilities(...CHAT),
    dataLeaves:
      'Message text, channel names and the matter updates the agent posts.',
  },
  {
    id: 'slack',
    name: 'Slack',
    group: 'team-chat',
    status: 'planned',
    summary: 'Answer questions and post updates in your channels.',
    description:
      'Bring the agent into the channels where the team already works, so a question is answered in the thread and a matter update arrives where people will see it.',
    visual: { kind: 'mark', key: 'slack' },
    capabilities: capabilities(...CHAT),
    dataLeaves: 'Message text, channel names and the updates it posts.',
  },
  {
    id: 'microsoft-teams',
    name: 'Microsoft Teams',
    group: 'team-chat',
    status: 'planned',
    summary: 'Work alongside the team in their channels and chats.',
    description:
      'Let the agent answer in a Teams channel or chat and send the updates a matter needs, without asking anyone to move tools.',
    visual: { kind: 'lettermark', letters: 'T', hex: '#5059C9' },
    capabilities: capabilities(...CHAT),
    dataLeaves: 'Message text, channel names and the updates it posts.',
  },
  {
    id: 'discord',
    name: 'Discord',
    group: 'team-chat',
    status: 'planned',
    summary: 'Answer and post in the servers it is invited to.',
    description:
      'Give the agent a place in a Discord server so a busy channel gets answers and updates without anyone leaving the conversation.',
    visual: { kind: 'mark', key: 'discord' },
    capabilities: capabilities(...CHAT),
    dataLeaves: 'Message text, channel names and the updates it posts.',
  },
  {
    id: 'google-chat',
    name: 'Google Chat',
    group: 'team-chat',
    status: 'planned',
    summary: 'Answer questions in spaces and direct messages.',
    description:
      'Reach the team inside Google Chat, where the agent replies to a question in a space or messages a colleague directly.',
    visual: { kind: 'mark', key: 'googlechat' },
    capabilities: capabilities(...CHAT),
    dataLeaves: 'Message text, space names and the updates it posts.',
  },
  {
    id: 'microsoft-outlook',
    name: 'Microsoft Outlook',
    group: 'email-calendar',
    status: 'planned',
    summary: 'Read the threads you give it and draft the reply.',
    description:
      'Hand the agent a thread and it reads the history, drafts a reply in your voice and brings the attachments into the matter.',
    visual: { kind: 'lettermark', letters: 'O', hex: '#0F6CBD' },
    capabilities: capabilities(
      ['Read mail it is given', 'Only threads you add or forward.'],
      ['Draft replies', 'Prepare a reply for you to send.'],
      ['Find attachments', 'Pull the right file into a matter.'],
    ),
    dataLeaves: 'The subject, body and attachments of the threads you give it.',
  },
  {
    id: 'gmail',
    name: 'Gmail',
    group: 'email-calendar',
    status: 'planned',
    summary: 'Read the threads you give it and draft the reply.',
    description:
      'Hand the agent a thread and it reads the history, drafts a reply and brings the attachments into the matter, inside the mail you already use.',
    visual: { kind: 'mark', key: 'gmail' },
    capabilities: capabilities(
      ['Read mail it is given', 'Only threads you add or forward.'],
      ['Draft replies', 'Prepare a reply for you to send.'],
      ['Find attachments', 'Pull the right file into a matter.'],
    ),
    dataLeaves: 'The subject, body and attachments of the threads you give it.',
  },
  {
    id: 'microsoft-365-calendar',
    name: 'Microsoft 365 Calendar',
    group: 'email-calendar',
    status: 'planned',
    summary: 'See the diary and put deadlines in it.',
    description:
      'The agent reads the diary to find hearings and deadlines, suggests time that suits everyone and records the dates a matter must meet.',
    visual: { kind: 'lettermark', letters: '365', hex: '#0F6CBD' },
    capabilities: capabilities(...CALENDAR),
    dataLeaves: 'Meeting titles, times and the people invited.',
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    group: 'email-calendar',
    status: 'planned',
    summary: 'See the diary and put deadlines in it.',
    description:
      'The agent reads the diary to find hearings and deadlines, suggests time that suits everyone and records the dates a matter must meet.',
    visual: { kind: 'mark', key: 'googlecalendar' },
    capabilities: capabilities(...CALENDAR),
    dataLeaves: 'Meeting titles, times and the people invited.',
  },
  {
    id: 'sharepoint-and-onedrive',
    name: 'SharePoint and OneDrive',
    group: 'documents',
    status: 'planned',
    summary: 'Work in the folders the team keeps its papers in.',
    description:
      'Point the agent at the folders a matter lives in so it can read the papers, save drafts back and make the folder searchable.',
    visual: { kind: 'lettermark', letters: 'SP', hex: '#036C70' },
    capabilities: capabilities(...STORAGE),
    dataLeaves: 'File names and the contents of the folders you choose.',
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    group: 'documents',
    status: 'planned',
    summary: 'Work in the folders the team keeps its papers in.',
    description:
      'Point the agent at the folders a matter lives in so it can read the papers, save drafts back and make the folder searchable.',
    visual: { kind: 'mark', key: 'googledrive' },
    capabilities: capabilities(...STORAGE),
    dataLeaves: 'File names and the contents of the folders you choose.',
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    group: 'documents',
    status: 'planned',
    summary: 'Read chosen folders and save drafts back.',
    description:
      'Give the agent a folder in Dropbox and it reads what the matter needs, writes the drafts back and leaves everything else alone.',
    visual: { kind: 'mark', key: 'dropbox' },
    capabilities: capabilities(...STORAGE),
    dataLeaves: 'File names and the contents of the folders you choose.',
  },
  {
    id: 'box',
    name: 'Box',
    group: 'documents',
    status: 'planned',
    summary: 'Read chosen folders and save drafts back.',
    description:
      'Give the agent a folder in Box and it reads what the matter needs, writes the drafts back and leaves everything else alone.',
    visual: { kind: 'mark', key: 'box' },
    capabilities: capabilities(...STORAGE),
    dataLeaves: 'File names and the contents of the folders you choose.',
  },
  {
    id: 'imanage-work',
    name: 'iManage Work',
    group: 'documents',
    status: 'planned',
    summary: 'Work with the documents the firm files in iManage.',
    description:
      'Read and save into the workspaces the firm already files in, so the agent works on the authoritative copy rather than a download.',
    visual: { kind: 'lettermark', letters: 'iM', hex: '#1C4E80' },
    capabilities: capabilities(...STORAGE),
    dataLeaves: 'File names and the contents of the workspaces you choose.',
  },
  {
    id: 'netdocuments',
    name: 'NetDocuments',
    group: 'documents',
    status: 'planned',
    summary: 'Work with the documents the firm files in NetDocuments.',
    description:
      'Read and save into the cabinets the firm already files in, so the agent works on the authoritative copy rather than a download.',
    visual: { kind: 'lettermark', letters: 'ND', hex: '#C8102E' },
    capabilities: capabilities(...STORAGE),
    dataLeaves: 'File names and the contents of the cabinets you choose.',
  },
  {
    id: 'clio',
    name: 'Clio',
    group: 'practice',
    status: 'planned',
    summary: 'Read matters, log time and create tasks.',
    description:
      'Connect the practice management system so the agent can look up the matter and client, record time against it and add the tasks that follow.',
    visual: { kind: 'lettermark', letters: 'C', hex: '#0B4C8C' },
    capabilities: capabilities(...PRACTICE),
    dataLeaves: 'Client and matter names, time entries and task details.',
  },
  {
    id: 'leap',
    name: 'LEAP',
    group: 'practice',
    status: 'planned',
    summary: 'Read matters, log time and create tasks.',
    description:
      'Connect LEAP so the agent can look up the matter and client, record time against it and add the tasks that follow.',
    visual: { kind: 'lettermark', letters: 'L', hex: '#0B5FA5' },
    capabilities: capabilities(...PRACTICE),
    dataLeaves: 'Client and matter names, time entries and task details.',
  },
  {
    id: 'actionstep',
    name: 'Actionstep',
    group: 'practice',
    status: 'planned',
    summary: 'Read matters, log time and create tasks.',
    description:
      'Connect Actionstep so the agent can look up the matter and client, record time against it and add the tasks that follow.',
    visual: { kind: 'lettermark', letters: 'A', hex: '#1B4F8A' },
    capabilities: capabilities(...PRACTICE),
    dataLeaves: 'Client and matter names, time entries and task details.',
  },
  {
    id: 'osprey',
    name: 'Osprey',
    group: 'practice',
    status: 'planned',
    summary: 'Read matters, log time and create tasks.',
    description:
      'Connect Osprey so the agent can look up the matter and client, record time against it and add the tasks that follow.',
    visual: { kind: 'lettermark', letters: 'O', hex: '#2F6F5E' },
    capabilities: capabilities(...PRACTICE),
    dataLeaves: 'Client and matter names, time entries and task details.',
  },
  {
    id: 'docusign',
    name: 'DocuSign',
    group: 'signing',
    status: 'planned',
    summary: 'Prepare envelopes and follow who has signed.',
    description:
      'The agent assembles the documents and signers into an envelope, sends it on your word and reports who has signed and who has not.',
    visual: { kind: 'mark', key: 'docusign' },
    capabilities: capabilities(...SIGNING),
    dataLeaves: 'The documents sent to sign and the signers’ names and emails.',
  },
  {
    id: 'adobe-acrobat-sign',
    name: 'Adobe Acrobat Sign',
    group: 'signing',
    status: 'planned',
    summary: 'Prepare envelopes and follow who has signed.',
    description:
      'The agent assembles the documents and signers into an envelope, sends it on your word and reports who has signed and who has not.',
    visual: { kind: 'mark', key: 'adobe' },
    capabilities: capabilities(...SIGNING),
    dataLeaves: 'The documents sent to sign and the signers’ names and emails.',
  },
  {
    id: 'companies-house',
    name: 'Companies House',
    group: 'public-sources',
    status: 'planned',
    summary: 'Look up a company and follow its filings.',
    description:
      'Check a company’s registered details, read its filing history and hear when a client company files, from the public register.',
    visual: { kind: 'lettermark', letters: 'CH', hex: '#1D70B8' },
    capabilities: capabilities(
      ['Look up companies', 'Read a company’s registered details.'],
      ['Read filing history', 'See accounts and confirmation statements.'],
      ['Watch new filings', 'Hear when a named company files.'],
    ),
    dataLeaves: 'The company names and numbers it looks up.',
  },
  {
    id: 'hm-land-registry',
    name: 'HM Land Registry',
    group: 'public-sources',
    status: 'planned',
    summary: 'Read registered titles and follow changes.',
    description:
      'Read the registered title, its owner and its charges, and hear when a title a matter depends on changes on the public register.',
    visual: { kind: 'lettermark', letters: 'LR', hex: '#00703C' },
    capabilities: capabilities(
      ['Check title registers', 'Read the title, owner and charges.'],
      ['Look up title plans', 'See the extent of a registered title.'],
      ['Watch for changes', 'Hear when a named title changes.'],
    ),
    dataLeaves: 'The title numbers and addresses it looks up.',
  },
  {
    id: 'the-gazette',
    name: 'The Gazette',
    group: 'public-sources',
    status: 'planned',
    summary: 'Follow the notices that touch a matter.',
    description:
      'Search the official public record for insolvency, probate and other notices, and hear on the morning a notice names a client.',
    visual: { kind: 'lettermark', letters: 'G', hex: '#8A1538' },
    capabilities: capabilities(
      ['Watch notices', 'Follow insolvency and probate notices.'],
      ['Search by client', 'Find notices naming a client or company.'],
      ['Alert on new notices', 'Hear the morning a notice appears.'],
    ),
    dataLeaves: 'The names and search terms it watches for you.',
  },
  {
    id: 'legislation-gov-uk',
    name: 'legislation.gov.uk',
    group: 'public-sources',
    status: 'planned',
    summary: 'Read legislation in force and follow amendments.',
    description:
      'Read an Act or statutory instrument as it stands in force, check when its provisions commenced and hear when it is amended.',
    visual: { kind: 'lettermark', letters: 'L', hex: '#3F4A5A' },
    capabilities: capabilities(
      ['Look up legislation', 'Read an Act as it stands in force.'],
      ['Check commencement', 'See what is in force and when it began.'],
      ['Follow changes', 'Hear when a cited Act is amended.'],
    ),
    dataLeaves: 'The Acts and provisions it looks up.',
  },
]

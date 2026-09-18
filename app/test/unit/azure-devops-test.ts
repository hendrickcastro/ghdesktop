import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  normalizeAzureDevOpsOrganization,
  parseAzureDevOpsRemote,
} from '../../src/lib/azure-devops/azure-devops-remote'

describe('Azure DevOps', () => {
  describe('parseAzureDevOpsRemote', () => {
    it('parses a dev.azure.com clone URL', () => {
      const remote = parseAzureDevOpsRemote(
        'https://dev.azure.com/rockthesportup/FE-Swagger-Repovic/_git/FE-Swagger-Repovic'
      )
      assert.deepEqual(remote, {
        organization: 'rockthesportup',
        project: 'FE-Swagger-Repovic',
        repository: 'FE-Swagger-Repovic',
      })
    })

    it('ignores the organization embedded as a username', () => {
      const remote = parseAzureDevOpsRemote(
        'https://rockthesportup@dev.azure.com/rockthesportup/Paas/_git/RegistrationDB'
      )
      assert.equal(remote?.organization, 'rockthesportup')
      assert.equal(remote?.project, 'Paas')
      assert.equal(remote?.repository, 'RegistrationDB')
    })

    it('decodes project names with spaces', () => {
      const remote = parseAzureDevOpsRemote(
        'https://dev.azure.com/org/My%20Project/_git/my-repo'
      )
      assert.equal(remote?.project, 'My Project')
      assert.equal(remote?.repository, 'my-repo')
    })

    it('parses legacy visualstudio.com URLs with and without DefaultCollection', () => {
      assert.deepEqual(
        parseAzureDevOpsRemote('https://org.visualstudio.com/Proj/_git/Repo'),
        { organization: 'org', project: 'Proj', repository: 'Repo' }
      )
      assert.deepEqual(
        parseAzureDevOpsRemote(
          'https://org.visualstudio.com/DefaultCollection/Proj/_git/Repo'
        ),
        { organization: 'org', project: 'Proj', repository: 'Repo' }
      )
    })

    it('parses SSH URLs', () => {
      assert.deepEqual(
        parseAzureDevOpsRemote('git@ssh.dev.azure.com:v3/org/Proj/Repo'),
        { organization: 'org', project: 'Proj', repository: 'Repo' }
      )
    })

    it('resolves an organization-only URL, which is what git sends without the path', () => {
      const remote = parseAzureDevOpsRemote('https://dev.azure.com/org/')
      assert.deepEqual(remote, {
        organization: 'org',
        project: null,
        repository: null,
      })
    })

    it('returns null for a bare host, and for other hosts', () => {
      assert.equal(parseAzureDevOpsRemote('https://dev.azure.com/'), null)
      assert.equal(
        parseAzureDevOpsRemote('https://github.com/desktop/desktop.git'),
        null
      )
      assert.equal(parseAzureDevOpsRemote('not a url'), null)
    })
  })

  describe('normalizeAzureDevOpsOrganization', () => {
    it('accepts a bare name', () => {
      assert.equal(normalizeAzureDevOpsOrganization('  rockthesportup '), 'rockthesportup')
    })

    it('takes the name out of a dev.azure.com URL', () => {
      assert.equal(
        normalizeAzureDevOpsOrganization('https://dev.azure.com/rockthesportup/'),
        'rockthesportup'
      )
      assert.equal(
        normalizeAzureDevOpsOrganization('dev.azure.com/rockthesportup/Proj/_git/Repo'),
        'rockthesportup'
      )
    })

    it('takes the name out of a legacy visualstudio.com host', () => {
      assert.equal(
        normalizeAzureDevOpsOrganization('https://rockthesportup.visualstudio.com'),
        'rockthesportup'
      )
    })

    it('rejects empty input and names with characters Azure does not allow', () => {
      assert.equal(normalizeAzureDevOpsOrganization(''), null)
      assert.equal(normalizeAzureDevOpsOrganization('not an org'), null)
    })
  })
})

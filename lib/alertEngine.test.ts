import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  buildInflationModel: vi.fn(),
  buildLaborModel: vi.fn(),
  buildMarketsModel: vi.fn(),
  buildGlobalModel: vi.fn(),
  buildBondModel: vi.fn(),
  buildCreditModel: vi.fn(),
  buildHousingModel: vi.fn(),
  fetchAllData: vi.fn(),
  computeStressIndex: vi.fn(),
  getCached: vi.fn(),
  severityOf: vi.fn(),
}))

vi.mock('./inflation', () => ({ buildInflationModel: mocks.buildInflationModel }))
vi.mock('./labor', () => ({ buildLaborModel: mocks.buildLaborModel }))
vi.mock('./markets', () => ({ buildMarketsModel: mocks.buildMarketsModel }))
vi.mock('./global', () => ({ buildGlobalModel: mocks.buildGlobalModel }))
vi.mock('./bonds', () => ({ buildBondModel: mocks.buildBondModel }))
vi.mock('./credit', () => ({ buildCreditModel: mocks.buildCreditModel }))
vi.mock('./housing', () => ({ buildHousingModel: mocks.buildHousingModel }))
vi.mock('./fetchData', () => ({ fetchAllData: mocks.fetchAllData }))
vi.mock('./stressIndex', () => ({ computeStressIndex: mocks.computeStressIndex }))
vi.mock('./redis', () => ({ getCached: mocks.getCached }))
vi.mock('./alertSeverity', () => ({ severityOf: mocks.severityOf }))

import { buildAlertReport } from './alertEngine'

const builders = [
  mocks.buildInflationModel,
  mocks.buildLaborModel,
  mocks.buildMarketsModel,
  mocks.buildGlobalModel,
  mocks.buildBondModel,
  mocks.buildCreditModel,
  mocks.buildHousingModel,
]

beforeEach(() => {
  vi.clearAllMocks()
  builders.forEach((build, i) => {
    build.mockResolvedValue({
      available: true,
      status: { tone: i === 0 ? 'warn' : 'good' },
      alerts: i === 0 ? [{ id: 'cpi-4', title: 'CPI alert', what: 'CPI is high', why: 'Prices matter' }] : [],
      watching: i === 1 ? [
        { label: 'Payroll Growth', text: '7k above the 50k slowdown trigger', proximity: 0.88, key: 'employment' },
        { label: 'Job Openings', text: 'comfortable', proximity: 0.4, key: 'hiring' },
      ] : [],
    })
  })
  mocks.fetchAllData.mockResolvedValue({})
  mocks.computeStressIndex.mockReturnValue({ total: 42 })
  mocks.getCached.mockImplementation((_key, _ttl, build) => build())
  mocks.severityOf.mockReturnValue(2)
})

describe('buildAlertReport', () => {
  it('uses fresh model builders by default', async () => {
    const report = await buildAlertReport()

    expect(mocks.getCached).not.toHaveBeenCalled()
    expect(mocks.buildInflationModel).toHaveBeenCalledTimes(1)
    expect(report.alerts).toEqual([
      expect.objectContaining({ key: 'inflation:cpi-4', tab: 'inflation', severity: 2 }),
    ])
    expect(report.breakLevel).toBe(42)
  })

  it('returns a separate low-noise watching layer', async () => {
    const report = await buildAlertReport()

    expect(report.watching).toEqual([
      expect.objectContaining({
        key: 'labor:employment',
        tab: 'labor',
        tabLabel: 'Labor',
        label: 'Payroll Growth',
        heat: 'warming',
      }),
    ])
    expect(report.watching.find(w => w.id === 'hiring')).toBeUndefined()
  })

  it('uses the tab model caches in cached mode', async () => {
    await buildAlertReport({ mode: 'cached' })

    expect(mocks.getCached).toHaveBeenCalledTimes(7)
    expect(mocks.getCached).toHaveBeenNthCalledWith(1, 'inflation', 3600, mocks.buildInflationModel, expect.any(Function))
    expect(mocks.getCached).toHaveBeenNthCalledWith(5, 'bonds', 300, mocks.buildBondModel, expect.any(Function))
    expect(mocks.getCached).toHaveBeenNthCalledWith(7, 'housing', 3600, mocks.buildHousingModel, expect.any(Function))
  })
})

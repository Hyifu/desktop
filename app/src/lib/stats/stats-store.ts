import { StatsDatabase, ILaunchStats, IDailyMeasures } from './stats-database'
import { getDotComAPIEndpoint } from '../api'
import { getVersion } from '../../ui/lib/app-proxy'
import { hasShownWelcomeFlow } from '../welcome'
import { Account } from '../../models/account'
import { getOS } from '../get-os'
import { getGUID } from './get-guid'
import { Repository } from '../../models/repository'
import { merge } from '../../lib/merge'
import { getPersistedThemeName } from '../../ui/lib/application-theme'
import { IUiActivityMonitor } from '../../ui/lib/ui-activity-monitor'
import { Disposable } from 'event-kit'

const StatsEndpoint = 'https://central.github.com/api/usage/desktop'

/** The URL to the stats samples page. */
export const SamplesURL = 'https://desktop.github.com/usage-data/'

const LastDailyStatsReportKey = 'last-daily-stats-report'

/** The localStorage key for whether the user has opted out. */
const StatsOptOutKey = 'stats-opt-out'

/** Have we successfully sent the stats opt-in? */
const HasSentOptInPingKey = 'has-sent-stats-opt-in-ping'

const WelcomeWizardInitiatedAtKey = 'welcome-wizard-initiated-at'
const WelcomeWizardCompletedAtKey = 'welcome-wizard-terminated-at'
const FirstRepositoryAddedAtKey = 'first-repository-added-at'
const FirstRepositoryClonedAtKey = 'first-repository-cloned-at'
const FirstRepositoryCreatedAtKey = 'first-repository-created-at'
const FirstCommitCreatedAtKey = 'first-commit-created-at'
const FirstPushToGitHubAtKey = 'first-push-to-github-at'
const FirstNonDefaultBranchCheckoutAtKey =
  'first-non-default-branch-checkout-at'

/** How often daily stats should be submitted (i.e., 24 hours). */
const DailyStatsReportInterval = 1000 * 60 * 60 * 24

const DefaultDailyMeasures: IDailyMeasures = {
  commits: 0,
  partialCommits: 0,
  openShellCount: 0,
  coAuthoredCommits: 0,
  branchComparisons: 0,
  defaultBranchComparisons: 0,
  mergesInitiatedFromComparison: 0,
  updateFromDefaultBranchMenuCount: 0,
  mergeIntoCurrentBranchMenuCount: 0,
  prBranchCheckouts: 0,
  repoWithIndicatorClicked: 0,
  repoWithoutIndicatorClicked: 0,
  divergingBranchBannerDismissal: 0,
  divergingBranchBannerInitatedMerge: 0,
  divergingBranchBannerInitiatedCompare: 0,
  divergingBranchBannerInfluencedMerge: 0,
  divergingBranchBannerDisplayed: 0,
  dotcomPushCount: 0,
  enterprisePushCount: 0,
  externalPushCount: 0,
  active: false,
  mergeConflictFromPullCount: 0,
  mergeConflictFromExplicitMergeCount: 0,
  mergedWithLoadingHintCount: 0,
  mergedWithCleanMergeHintCount: 0,
  mergedWithConflictWarningHintCount: 0,
}

interface IOnboardingStats {
  /**
   * Time (in seconds) from when the user first launched
   * the application and entered the welcome wizard until
   * the user added their first existing repository.
   *
   * A negative value means that this action hasn't yet
   * taken place while undefined means that the current
   * user installed desktop prior to this metric beeing
   * added and we will thus never be able to provide a
   * value.
   */
  readonly timeToFirstAddedRepository?: number

  /**
   * Time (in seconds) from when the user first launched
   * the application and entered the welcome wizard until
   * the user cloned their first repository.
   *
   * A negative value means that this action hasn't yet
   * taken place while undefined means that the current
   * user installed desktop prior to this metric beeing
   * added and we will thus never be able to provide a
   * value.
   */
  readonly timeToFirstClonedRepository?: number

  /**
   * Time (in seconds) from when the user first launched
   * the application and entered the welcome wizard until
   * the user created their first new repository.
   *
   * A negative value means that this action hasn't yet
   * taken place while undefined means that the current
   * user installed desktop prior to this metric beeing
   * added and we will thus never be able to provide a
   * value.
   */
  readonly timeToFirstCreatedRepository?: number

  /**
   * Time (in seconds) from when the user first launched
   * the application and entered the welcome wizard until
   * the user crafted their first commit.
   *
   * A negative value means that this action hasn't yet
   * taken place while undefined means that the current
   * user installed desktop prior to this metric beeing
   * added and we will thus never be able to provide a
   * value.
   */
  readonly timeToFirstCommit?: number

  /**
   * Time (in seconds) from when the user first launched
   * the application and entered the welcome wizard until
   * the user performed their first push of a repository
   * to GitHub.com or GitHub Enterprise. This metric
   * does not track pushes to non-GitHub remotes.
   */
  readonly timeToFirstGitHubPush?: number

  /**
   * Time (in seconds) from when the user first launched
   * the application and entered the welcome wizard until
   * the user first checked out a branch in any repository
   * which is not the default branch of that repository.
   *
   * Note that this metric will be set regardless of whether
   * that repository was a GitHub.com/GHE repository, local
   * repository or has a non-GitHub remote.
   *
   * A negative value means that this action hasn't yet
   * taken place while undefined means that the current
   * user installed desktop prior to this metric beeing
   * added and we will thus never be able to provide a
   * value.
   */
  readonly timeToFirstNonDefaultBranchCheckout?: number

  /**
   * Time (in seconds) from when the user first launched
   * the application and entered the welcome wizard until
   * the user completed the wizard.
   *
   * A negative value means that this action hasn't yet
   * taken place while undefined means that the current
   * user installed desktop prior to this metric beeing
   * added and we will thus never be able to provide a
   * value.
   */
  readonly timeToWelcomeWizardTerminated?: number
  readonly welcomeWizardSignInType?: 'basic' | 'web'
}

interface ICalculatedStats {
  /** The app version. */
  readonly version: string

  /** The OS version. */
  readonly osVersion: string

  /** The platform. */
  readonly platform: string

  /** The number of total repositories. */
  readonly repositoryCount: number

  /** The number of GitHub repositories. */
  readonly gitHubRepositoryCount: number

  /** The install ID. */
  readonly guid: string

  /** Is the user logged in with a GitHub.com account? */
  readonly dotComAccount: boolean

  /** Is the user logged in with an Enterprise account? */
  readonly enterpriseAccount: boolean

  /**
   * The name of the currently selected theme/application
   * appearance as set at time of stats submission.
   */
  readonly theme: string

  readonly eventType: 'usage'
}

type DailyStats = ICalculatedStats &
  ILaunchStats &
  IDailyMeasures &
  IOnboardingStats

/** The store for the app's stats. */
export class StatsStore {
  private readonly db: StatsDatabase
  private readonly uiActivityMonitor: IUiActivityMonitor
  private uiActivityMonitorSubscription: Disposable | null = null

  /** Has the user opted out of stats reporting? */
  private optOut: boolean

  public constructor(db: StatsDatabase, uiActivityMonitor: IUiActivityMonitor) {
    this.db = db
    this.uiActivityMonitor = uiActivityMonitor

    const optOutValue = localStorage.getItem(StatsOptOutKey)
    if (optOutValue) {
      this.optOut = !!parseInt(optOutValue, 10)

      // If the user has set an opt out value but we haven't sent the ping yet,
      // give it a shot now.
      if (!localStorage.getItem(HasSentOptInPingKey)) {
        this.sendOptInStatusPing(!this.optOut)
      }
    } else {
      this.optOut = false
    }

    this.enableUiActivityMonitoring()
  }

  /** Should the app report its daily stats? */
  private shouldReportDailyStats(): boolean {
    const lastDateString = localStorage.getItem(LastDailyStatsReportKey)
    let lastDate = 0
    if (lastDateString && lastDateString.length > 0) {
      lastDate = parseInt(lastDateString, 10)
    }

    if (isNaN(lastDate)) {
      lastDate = 0
    }

    const now = Date.now()
    return now - lastDate > DailyStatsReportInterval
  }

  /** Report any stats which are eligible for reporting. */
  public async reportStats(
    accounts: ReadonlyArray<Account>,
    repositories: ReadonlyArray<Repository>
  ) {
    if (this.optOut) {
      return
    }

    // Never report stats while in dev or test. They could be pretty crazy.
    if (__DEV__ || process.env.TEST_ENV) {
      return
    }

    // don't report until the user has had a chance to view and opt-in for
    // sharing their stats with us
    if (!hasShownWelcomeFlow()) {
      return
    }

    if (!this.shouldReportDailyStats()) {
      return
    }

    const now = Date.now()
    const stats = await this.getDailyStats(accounts, repositories)

    try {
      const response = await this.post(stats)
      if (!response.ok) {
        throw new Error(
          `Unexpected status: ${response.statusText} (${response.status})`
        )
      }

      log.info('Stats reported.')

      await this.clearDailyStats()
      localStorage.setItem(LastDailyStatsReportKey, now.toString())
    } catch (e) {
      log.error('Error reporting stats:', e)
    }
  }

  /** Record the given launch stats. */
  public async recordLaunchStats(stats: ILaunchStats) {
    await this.db.launches.add(stats)
  }

  /**
   * Clear the stored daily stats. Not meant to be called
   * directly. Marked as public in order to enable testing
   * of a specific scenario, see stats-store-tests for more
   * detail.
   */
  public async clearDailyStats() {
    await this.db.launches.clear()
    await this.db.dailyMeasures.clear()

    this.enableUiActivityMonitoring()
  }

  private enableUiActivityMonitoring() {
    if (this.uiActivityMonitorSubscription !== null) {
      return
    }

    this.uiActivityMonitorSubscription = this.uiActivityMonitor.onActivity(
      this.onUiActivity
    )
  }

  private disableUiActivityMonitoring() {
    if (this.uiActivityMonitorSubscription === null) {
      return
    }

    this.uiActivityMonitorSubscription.dispose()
    this.uiActivityMonitorSubscription = null
  }

  /** Get the daily stats. */
  private async getDailyStats(
    accounts: ReadonlyArray<Account>,
    repositories: ReadonlyArray<Repository>
  ): Promise<DailyStats> {
    const launchStats = await this.getAverageLaunchStats()
    const dailyMeasures = await this.getDailyMeasures()
    const userType = this.determineUserType(accounts)
    const repositoryCounts = this.categorizedRepositoryCounts(repositories)
    const onboardingStats = this.getOnboardingStats()

    return {
      eventType: 'usage',
      version: getVersion(),
      osVersion: getOS(),
      platform: process.platform,
      theme: getPersistedThemeName(),
      ...launchStats,
      ...dailyMeasures,
      ...userType,
      ...onboardingStats,
      guid: getGUID(),
      ...repositoryCounts,
    }
  }

  private getOnboardingStats(): IOnboardingStats {
    const wizardInitiatedAt = getLocalStorageTimestamp(
      WelcomeWizardInitiatedAtKey
    )

    // If we don't have a start time for the wizard none of our other metrics
    // makes sense. This will happen for users who installed the app before
    // we started tracking onboarding stats.
    if (wizardInitiatedAt === null) {
      return {}
    }

    const timeToWelcomeWizardTerminated = timeToFirst(
      WelcomeWizardCompletedAtKey
    )

    const timeToFirstAddedRepository = timeToFirst(FirstRepositoryAddedAtKey)
    const timeToFirstClonedRepository = timeToFirst(FirstRepositoryClonedAtKey)
    const timeToFirstCreatedRepository = timeToFirst(
      FirstRepositoryCreatedAtKey
    )

    const timeToFirstCommit = timeToFirst(FirstCommitCreatedAtKey)
    const timeToFirstGitHubPush = timeToFirst(FirstPushToGitHubAtKey)
    const timeToFirstNonDefaultBranchCheckout = timeToFirst(
      FirstNonDefaultBranchCheckoutAtKey
    )

    return {
      timeToWelcomeWizardTerminated,
      timeToFirstAddedRepository,
      timeToFirstClonedRepository,
      timeToFirstCreatedRepository,
      timeToFirstCommit,
      timeToFirstGitHubPush,
      timeToFirstNonDefaultBranchCheckout,
    }
  }

  private categorizedRepositoryCounts(repositories: ReadonlyArray<Repository>) {
    return {
      repositoryCount: repositories.length,
      gitHubRepositoryCount: repositories.filter(r => r.gitHubRepository)
        .length,
    }
  }

  /** Determines if an account is a dotCom and/or enterprise user */
  private determineUserType(accounts: ReadonlyArray<Account>) {
    const dotComAccount = !!accounts.find(
      a => a.endpoint === getDotComAPIEndpoint()
    )
    const enterpriseAccount = !!accounts.find(
      a => a.endpoint !== getDotComAPIEndpoint()
    )

    return {
      dotComAccount,
      enterpriseAccount,
    }
  }

  /** Calculate the average launch stats. */
  private async getAverageLaunchStats(): Promise<ILaunchStats> {
    const launches:
      | ReadonlyArray<ILaunchStats>
      | undefined = await this.db.launches.toArray()
    if (!launches || !launches.length) {
      return {
        mainReadyTime: -1,
        loadTime: -1,
        rendererReadyTime: -1,
      }
    }

    const start: ILaunchStats = {
      mainReadyTime: 0,
      loadTime: 0,
      rendererReadyTime: 0,
    }

    const totals = launches.reduce((running, current) => {
      return {
        mainReadyTime: running.mainReadyTime + current.mainReadyTime,
        loadTime: running.loadTime + current.loadTime,
        rendererReadyTime:
          running.rendererReadyTime + current.rendererReadyTime,
      }
    }, start)

    return {
      mainReadyTime: totals.mainReadyTime / launches.length,
      loadTime: totals.loadTime / launches.length,
      rendererReadyTime: totals.rendererReadyTime / launches.length,
    }
  }

  /** Get the daily measures. */
  private async getDailyMeasures(): Promise<IDailyMeasures> {
    const measures:
      | IDailyMeasures
      | undefined = await this.db.dailyMeasures.limit(1).first()
    return {
      ...DefaultDailyMeasures,
      ...measures,
      // We could spread the database ID in, but we really don't want it.
      id: undefined,
    }
  }

  private async updateDailyMeasures<K extends keyof IDailyMeasures>(
    fn: (measures: IDailyMeasures) => Pick<IDailyMeasures, K>
  ): Promise<void> {
    const defaultMeasures = DefaultDailyMeasures
    await this.db.transaction('rw', this.db.dailyMeasures, async () => {
      const measures = await this.db.dailyMeasures.limit(1).first()
      const measuresWithDefaults = {
        ...defaultMeasures,
        ...measures,
      }
      const newMeasures = merge(measuresWithDefaults, fn(measuresWithDefaults))

      return this.db.dailyMeasures.put(newMeasures)
    })
  }

  /** Record that a commit was accomplished. */
  public async recordCommit(): Promise<void> {
    await this.updateDailyMeasures(m => ({
      commits: m.commits + 1,
    }))

    createLocalStorageTimestamp(FirstCommitCreatedAtKey)
  }

  /** Record that a partial commit was accomplished. */
  public recordPartialCommit(): Promise<void> {
    return this.updateDailyMeasures(m => ({
      partialCommits: m.partialCommits + 1,
    }))
  }

  /** Record that a commit was created with one or more co-authors. */
  public recordCoAuthoredCommit(): Promise<void> {
    return this.updateDailyMeasures(m => ({
      coAuthoredCommits: m.coAuthoredCommits + 1,
    }))
  }

  /** Record that the user opened a shell. */
  public recordOpenShell(): Promise<void> {
    return this.updateDailyMeasures(m => ({
      openShellCount: m.openShellCount + 1,
    }))
  }

  /** Record that a branch comparison has been made */
  public recordBranchComparison(): Promise<void> {
    return this.updateDailyMeasures(m => ({
      branchComparisons: m.branchComparisons + 1,
    }))
  }

  /** Record that a branch comparison has been made to the `master` branch */
  public recordDefaultBranchComparison(): Promise<void> {
    return this.updateDailyMeasures(m => ({
      defaultBranchComparisons: m.defaultBranchComparisons + 1,
    }))
  }

  /** Record that a merge has been initiated from the `compare` sidebar */
  public recordCompareInitiatedMerge(): Promise<void> {
    return this.updateDailyMeasures(m => ({
      mergesInitiatedFromComparison: m.mergesInitiatedFromComparison + 1,
    }))
  }

  /** Record that a merge has been initiated from the `Branch -> Update From Default Branch` menu item */
  public recordMenuInitiatedUpdate(): Promise<void> {
    return this.updateDailyMeasures(m => ({
      updateFromDefaultBranchMenuCount: m.updateFromDefaultBranchMenuCount + 1,
    }))
  }

  /** Record that conflicts were detected by a merge initiated by Desktop */
  public recordMergeConflictFromPull(): Promise<void> {
    return this.updateDailyMeasures(m => ({
      mergeConflictFromPullCount: m.mergeConflictFromPullCount + 1,
    }))
  }

  /** Record that conflicts were detected by a merge initiated by Desktop */
  public recordMergeConflictFromExplicitMerge(): Promise<void> {
    return this.updateDailyMeasures(m => ({
      mergeConflictFromExplicitMergeCount:
        m.mergeConflictFromExplicitMergeCount + 1,
    }))
  }

  /** Record that a merge has been initiated from the `Branch -> Merge Into Current Branch` menu item */
  public recordMenuInitiatedMerge(): Promise<void> {
    return this.updateDailyMeasures(m => ({
      mergeIntoCurrentBranchMenuCount: m.mergeIntoCurrentBranchMenuCount + 1,
    }))
  }

  /** Record that the user checked out a PR branch */
  public recordPRBranchCheckout(): Promise<void> {
    return this.updateDailyMeasures(m => ({
      prBranchCheckouts: m.prBranchCheckouts + 1,
    }))
  }

  public recordRepoClicked(repoHasIndicator: boolean): Promise<void> {
    if (repoHasIndicator) {
      return this.updateDailyMeasures(m => ({
        repoWithIndicatorClicked: m.repoWithIndicatorClicked + 1,
      }))
    }
    return this.updateDailyMeasures(m => ({
      repoWithoutIndicatorClicked: m.repoWithoutIndicatorClicked + 1,
    }))
  }

  /** Set whether the user has opted out of stats reporting. */
  public async setOptOut(optOut: boolean): Promise<void> {
    const changed = this.optOut !== optOut

    this.optOut = optOut

    localStorage.setItem(StatsOptOutKey, optOut ? '1' : '0')

    if (changed) {
      await this.sendOptInStatusPing(!optOut)
    }
  }

  /** Has the user opted out of stats reporting? */
  public getOptOut(): boolean {
    return this.optOut
  }

  /** Record that user dismissed diverging branch notification */
  public async recordDivergingBranchBannerDismissal(): Promise<void> {
    return this.updateDailyMeasures(m => ({
      divergingBranchBannerDismissal: m.divergingBranchBannerDismissal + 1,
    }))
  }

  /** Record that user initiated a merge from within the notification banner */
  public async recordDivergingBranchBannerInitatedMerge(): Promise<void> {
    return this.updateDailyMeasures(m => ({
      divergingBranchBannerInitatedMerge:
        m.divergingBranchBannerInitatedMerge + 1,
    }))
  }

  /** Record that user initiated a compare from within the notification banner */
  public async recordDivergingBranchBannerInitiatedCompare(): Promise<void> {
    return this.updateDailyMeasures(m => ({
      divergingBranchBannerInitiatedCompare:
        m.divergingBranchBannerInitiatedCompare + 1,
    }))
  }

  /**
   * Record that user initiated a merge after getting to compare view
   * from within notificatio banner
   */
  public async recordDivergingBranchBannerInfluencedMerge(): Promise<void> {
    return this.updateDailyMeasures(m => ({
      divergingBranchBannerInfluencedMerge:
        m.divergingBranchBannerInfluencedMerge + 1,
    }))
  }

  /** Record that the user was shown the notification banner */
  public async recordDivergingBranchBannerDisplayed(): Promise<void> {
    return this.updateDailyMeasures(m => ({
      divergingBranchBannerDisplayed: m.divergingBranchBannerDisplayed + 1,
    }))
  }

  /** Record that the user pushed to GitHub.com */
  public async recordPushToGitHub(): Promise<void> {
    await this.updateDailyMeasures(m => ({
      dotcomPushCount: m.dotcomPushCount + 1,
    }))

    createLocalStorageTimestamp(FirstPushToGitHubAtKey)
  }

  /** Record that the user pushed to a GitHub Enterprise instance */
  public async recordPushToGitHubEnterprise(): Promise<void> {
    await this.updateDailyMeasures(m => ({
      enterprisePushCount: m.enterprisePushCount + 1,
    }))

    // Note, this is not a typo. We track both GitHub.com and
    // GitHub Enteprise under the same key
    createLocalStorageTimestamp(FirstPushToGitHubAtKey)
  }

  /** Record that the user pushed to a generic remote */
  public async recordPushToGenericRemote(): Promise<void> {
    return this.updateDailyMeasures(m => ({
      externalPushCount: m.externalPushCount + 1,
    }))
  }

  /** Record that the user saw a 'merge conflicts' warning but continued with the merge */
  public async recordUserProceededWhileLoading(): Promise<void> {
    return this.updateDailyMeasures(m => ({
      mergedWithLoadingHintCount: m.mergedWithLoadingHintCount + 1,
    }))
  }

  /** Record that the user saw a 'merge conflicts' warning but continued with the merge */
  public async recordMergeHintSuccessAndUserProceeded(): Promise<void> {
    return this.updateDailyMeasures(m => ({
      mergedWithCleanMergeHintCount: m.mergedWithCleanMergeHintCount + 1,
    }))
  }

  /** Record that the user saw a 'merge conflicts' warning but continued with the merge */
  public async recordUserProceededAfterConflictWarning(): Promise<void> {
    return this.updateDailyMeasures(m => ({
      mergedWithConflictWarningHintCount:
        m.mergedWithConflictWarningHintCount + 1,
    }))
  }

  public recordWelcomeWizardInitiated() {
    localStorage.setItem(WelcomeWizardInitiatedAtKey, `${Date.now()}`)
    localStorage.removeItem(WelcomeWizardCompletedAtKey)
  }

  public recordWelcomeWizardTerminated() {
    localStorage.setItem(WelcomeWizardCompletedAtKey, `${Date.now()}`)
  }

  public recordAddRepository() {
    createLocalStorageTimestamp(FirstRepositoryAddedAtKey)
  }

  public recordCloneRepository() {
    createLocalStorageTimestamp(FirstRepositoryClonedAtKey)
  }

  public recordCreateRepository() {
    createLocalStorageTimestamp(FirstRepositoryCreatedAtKey)
  }

  public recordNonDefaultBranchCheckout() {
    createLocalStorageTimestamp(FirstNonDefaultBranchCheckoutAtKey)
  }

  private onUiActivity = async () => {
    this.disableUiActivityMonitoring()

    return this.updateDailyMeasures(m => ({
      active: true,
    }))
  }

  /** Post some data to our stats endpoint. */
  private post(body: object): Promise<Response> {
    const options: RequestInit = {
      method: 'POST',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    }

    return fetch(StatsEndpoint, options)
  }

  private async sendOptInStatusPing(optIn: boolean): Promise<void> {
    const direction = optIn ? 'in' : 'out'
    try {
      const response = await this.post({
        eventType: 'ping',
        optIn,
      })
      if (!response.ok) {
        throw new Error(
          `Unexpected status: ${response.statusText} (${response.status})`
        )
      }

      localStorage.setItem(HasSentOptInPingKey, '1')

      log.info(`Opt ${direction} reported.`)
    } catch (e) {
      log.error(`Error reporting opt ${direction}:`, e)
    }
  }
}

/**
 * Store the current date (in unix time) in localStorage.
 *
 * If the provided key already exists it will not be
 * overwritten.
 */
function createLocalStorageTimestamp(key: string) {
  if (localStorage.getItem(key) !== null) {
    return
  }

  localStorage.setItem(key, `${Date.now()}`)
}

/**
 * Get a time stamp (in unix time) from localStorage.
 *
 * If the key doesn't exist or if the stored value can't
 * be converted into a number this method will return null.
 */
function getLocalStorageTimestamp(key: string): number | null {
  const value = parseInt(localStorage.getItem(key) || '', 10)
  return isNaN(value) ? null : value
}

/**
 * Calculated the duration (in seconds) between the time the
 * welcome wizard was initiated to the time for the given
 * action.
 *
 * If no time stamp exists for when the welcome wizard was
 * initiated, which would be the case if the user completed
 * the wizard before we introduced onboarding metrics, or if
 * the delta between the two values are negative (which could
 * happen if a user manually manipulated localStorage in order
 * to run the wizard again) this method will return undefined.
 */
function timeToFirst(key: string): number | undefined {
  const startTime = getLocalStorageTimestamp(WelcomeWizardInitiatedAtKey)

  if (startTime === null) {
    return undefined
  }

  const endTime = getLocalStorageTimestamp(key)
  return endTime === null || endTime <= startTime
    ? -1
    : Math.round((endTime - startTime) / 1000)
}

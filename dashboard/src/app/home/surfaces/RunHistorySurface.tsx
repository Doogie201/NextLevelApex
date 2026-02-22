"use client";

import type { ChangeEvent, Dispatch, RefObject, SetStateAction } from "react";

import type { BundleImportValidationError } from "@/engine/bundleImport";
import type { CaseBundle } from "@/engine/caseBundle";
import type { CaseLibraryEntry, CaseLibraryIntegritySummary } from "@/engine/caseLibraryStore";
import type { CaseProvenanceModel } from "@/engine/caseProvenance";
import type { RunHistoryCompareSelection, RunHistoryShareSafeDiff } from "@/engine/runHistoryCompare";
import type { RunHistoryEntry, RunHistorySortOrder, RunHistoryStatusFilter } from "@/engine/runHistoryStore";
import type { RunDetailsModel, RunDetailsSection, TruncationResult } from "@/engine/runShareSafeExport";
import RunHistoryComparePanel from "./runHistory/RunHistoryComparePanel";
import RunHistoryDetailsPanel from "./runHistory/RunHistoryDetailsPanel";
import RunHistoryList from "./runHistory/RunHistoryList";
import RunHistoryNoticesAndFilters from "./runHistory/RunHistoryNoticesAndFilters";
import RunHistoryProvenancePanel from "./runHistory/RunHistoryProvenancePanel";
import RunHistoryToolbar from "./runHistory/RunHistoryToolbar";

export interface RunHistoryListRow {
  id: string;
  bundleLabel: string;
  badge: string | null;
  commandId: string | null;
  reasonCode: string | null;
  bundleId: string;
  startedAt: string | null;
  pinned: boolean;
  source: "history" | "case";
  entry?: RunHistoryEntry;
}

export interface RunHistorySurfaceProps {
  activeCaseLibraryEntry: CaseLibraryEntry | null;
  activeCaseLibraryId: string | null;
  activeRunHistoryRows: RunHistoryListRow[];
  caseBundleImportInputRef: RefObject<HTMLInputElement | null>;
  caseBundleMode: CaseBundle | null;
  caseLibraryEntries: CaseLibraryEntry[];
  caseLibraryIntegrityById: Map<string, CaseLibraryIntegritySummary>;
  caseLibraryNotice: string | null;
  caseLibraryQuery: string;
  caseModeFingerprint: string | null;
  caseModeNotice: string | null;
  caseNotesDraft: string;
  caseProvenance: CaseProvenanceModel | null;
  compareBaseRunHistoryRow: RunHistoryListRow | null;
  compareTargetRunHistoryRow: RunHistoryListRow | null;
  confirmCaseLibraryDeleteId: string | null;
  confirmRunHistoryClear: boolean;
  errorDetailsPreview: TruncationResult | null;
  filteredCaseLibraryEntries: CaseLibraryEntry[];
  inputDetailsPreview: TruncationResult | null;
  isBusy: boolean;
  outputDetailsPreview: TruncationResult | null;
  renderedErrorDetailsText: string;
  renderedInputDetailsText: string;
  renderedOutputDetailsText: string;
  runDetailsExpanded: Record<RunDetailsSection, boolean>;
  runHistoryCanCompareEntries: boolean;
  runHistoryCompareDiff: RunHistoryShareSafeDiff | null;
  runHistoryCompareSelection: RunHistoryCompareSelection;
  runHistoryDetailsHeadingRef: RefObject<HTMLHeadingElement | null>;
  runHistoryEntries: RunHistoryEntry[];
  runHistoryErrors: BundleImportValidationError[];
  runHistoryPanelRef: RefObject<HTMLElement | null>;
  runHistoryPersistenceNotice: string | null;
  runHistoryQuery: string;
  runHistoryRowId: (entryId: string) => string;
  runHistorySearchInputRef: RefObject<HTMLInputElement | null>;
  runHistorySortOrder: RunHistorySortOrder;
  runHistoryStatusFilter: RunHistoryStatusFilter;
  runHistoryTotalCount: number;
  selectedCaseLibraryEntry: CaseLibraryEntry | null;
  selectedRunDetails: RunDetailsModel | null;
  selectedRunHistoryRow: RunHistoryListRow | null;
  assignRunHistoryCompareRole: (role: "base" | "target", runId: string) => void;
  cancelCaseDelete: () => void;
  cancelRunHistoryClear: () => void;
  clearRunHistoryCompare: () => void;
  clearRunHistoryConfirmed: () => void;
  clearStoredCaseLibraryImmediately: () => void;
  clearStoredRunHistoryImmediately: () => void;
  confirmCaseDelete: (entryId: string) => void;
  copyCaseLibraryFingerprint: (entryId: string) => void | Promise<void>;
  copyCaseProvenance: () => void | Promise<void>;
  copyRunDetailsSection: (section: RunDetailsSection) => void | Promise<void>;
  exitCaseMode: () => void;
  formatTimestamp: (isoTime: string) => string;
  importCaseBundleFromFile: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  loadRunHistoryIntoEditor: (entryId: string) => void;
  openCaseBundleImportPicker: () => void;
  openCaseFromLibrary: (entryId: string) => void;
  pinRunHistoryAsSavedView: (entryId: string) => void | Promise<void>;
  replayRunHistory: (entryId: string) => void | Promise<void>;
  requestCaseBundleExportReview: () => void;
  requestCaseDelete: (entryId: string) => void;
  requestRunExportReview: () => void;
  requestRunHistoryClear: () => void;
  requestRunHistoryCompareDiffExport: () => void;
  resetRunHistoryFilters: () => void;
  saveActiveCaseNotes: () => void;
  saveCurrentCaseToLibrary: () => void;
  setCaseLibraryNotice: Dispatch<SetStateAction<string | null>>;
  setCaseLibraryQuery: Dispatch<SetStateAction<string>>;
  setCaseModeNotice: Dispatch<SetStateAction<string | null>>;
  setCaseNotesDraft: Dispatch<SetStateAction<string>>;
  setRunHistoryPersistenceNotice: Dispatch<SetStateAction<string | null>>;
  setRunHistoryQuery: Dispatch<SetStateAction<string>>;
  setRunHistorySortOrder: Dispatch<SetStateAction<RunHistorySortOrder>>;
  setRunHistoryStatusFilter: Dispatch<SetStateAction<RunHistoryStatusFilter>>;
  setSelectedCaseLibraryId: Dispatch<SetStateAction<string | null>>;
  setSelectedRunHistoryId: Dispatch<SetStateAction<string | null>>;
  swapRunHistoryCompareRoles: () => void;
  toShortFingerprint: (fingerprint: string) => string;
  toggleRunDetailsExpandedSection: (section: RunDetailsSection) => void;
  toggleRunHistoryCompareMode: () => void;
  toggleRunHistoryPinnedState: (entryId: string) => void;
}

export default function RunHistorySurface({
  activeCaseLibraryEntry,
  activeCaseLibraryId,
  activeRunHistoryRows,
  assignRunHistoryCompareRole,
  cancelRunHistoryClear,
  caseBundleImportInputRef,
  caseBundleMode,
  caseLibraryEntries,
  caseLibraryNotice,
  caseModeFingerprint,
  caseModeNotice,
  caseNotesDraft,
  caseProvenance,
  clearRunHistoryCompare,
  clearRunHistoryConfirmed,
  clearStoredCaseLibraryImmediately,
  clearStoredRunHistoryImmediately,
  compareBaseRunHistoryRow,
  compareTargetRunHistoryRow,
  confirmRunHistoryClear,
  copyCaseProvenance,
  copyRunDetailsSection,
  errorDetailsPreview,
  exitCaseMode,
  formatTimestamp,
  importCaseBundleFromFile,
  inputDetailsPreview,
  isBusy,
  loadRunHistoryIntoEditor,
  openCaseBundleImportPicker,
  outputDetailsPreview,
  pinRunHistoryAsSavedView,
  renderedErrorDetailsText,
  renderedInputDetailsText,
  renderedOutputDetailsText,
  replayRunHistory,
  requestCaseBundleExportReview,
  requestRunExportReview,
  requestRunHistoryClear,
  requestRunHistoryCompareDiffExport,
  resetRunHistoryFilters,
  runDetailsExpanded,
  runHistoryCanCompareEntries,
  runHistoryCompareDiff,
  runHistoryCompareSelection,
  runHistoryDetailsHeadingRef,
  runHistoryEntries,
  runHistoryErrors,
  runHistoryPanelRef,
  runHistoryPersistenceNotice,
  runHistoryQuery,
  runHistoryRowId,
  runHistorySearchInputRef,
  runHistorySortOrder,
  runHistoryStatusFilter,
  runHistoryTotalCount,
  saveActiveCaseNotes,
  saveCurrentCaseToLibrary,
  selectedRunDetails,
  selectedRunHistoryRow,
  setCaseLibraryNotice,
  setCaseModeNotice,
  setCaseNotesDraft,
  setRunHistoryPersistenceNotice,
  setRunHistoryQuery,
  setRunHistorySortOrder,
  setRunHistoryStatusFilter,
  setSelectedRunHistoryId,
  swapRunHistoryCompareRoles,
  toShortFingerprint,
  toggleRunDetailsExpandedSection,
  toggleRunHistoryCompareMode,
  toggleRunHistoryPinnedState,
}: RunHistorySurfaceProps) {
  return (
    <section
      ref={runHistoryPanelRef}
      className="empty-state-card"
      aria-label="Run history and replay"
      tabIndex={0}
    >
      <RunHistoryToolbar
        activeCaseLibraryEntry={activeCaseLibraryEntry}
        activeRunHistoryRows={activeRunHistoryRows}
        cancelRunHistoryClear={cancelRunHistoryClear}
        caseBundleImportInputRef={caseBundleImportInputRef}
        caseBundleMode={caseBundleMode}
        caseModeFingerprint={caseModeFingerprint}
        clearRunHistoryConfirmed={clearRunHistoryConfirmed}
        confirmRunHistoryClear={confirmRunHistoryClear}
        exitCaseMode={exitCaseMode}
        importCaseBundleFromFile={importCaseBundleFromFile}
        openCaseBundleImportPicker={openCaseBundleImportPicker}
        requestCaseBundleExportReview={requestCaseBundleExportReview}
        requestRunHistoryClear={requestRunHistoryClear}
        runHistoryCanCompareEntries={runHistoryCanCompareEntries}
        runHistoryCompareSelection={runHistoryCompareSelection}
        runHistoryEntries={runHistoryEntries}
        saveCurrentCaseToLibrary={saveCurrentCaseToLibrary}
        toShortFingerprint={toShortFingerprint}
        toggleRunHistoryCompareMode={toggleRunHistoryCompareMode}
      />
      <RunHistoryProvenancePanel
        caseProvenance={caseProvenance}
        copyCaseProvenance={copyCaseProvenance}
        formatTimestamp={formatTimestamp}
      />
      <RunHistoryNoticesAndFilters
        activeRunHistoryRows={activeRunHistoryRows}
        caseLibraryEntries={caseLibraryEntries}
        caseLibraryNotice={caseLibraryNotice}
        caseModeNotice={caseModeNotice}
        clearStoredCaseLibraryImmediately={clearStoredCaseLibraryImmediately}
        clearStoredRunHistoryImmediately={clearStoredRunHistoryImmediately}
        runHistoryPersistenceNotice={runHistoryPersistenceNotice}
        runHistoryQuery={runHistoryQuery}
        runHistorySearchInputRef={runHistorySearchInputRef}
        runHistorySortOrder={runHistorySortOrder}
        runHistoryStatusFilter={runHistoryStatusFilter}
        runHistoryTotalCount={runHistoryTotalCount}
        setCaseLibraryNotice={setCaseLibraryNotice}
        setCaseModeNotice={setCaseModeNotice}
        setRunHistoryPersistenceNotice={setRunHistoryPersistenceNotice}
        setRunHistoryQuery={setRunHistoryQuery}
        setRunHistorySortOrder={setRunHistorySortOrder}
        setRunHistoryStatusFilter={setRunHistoryStatusFilter}
      />
      <RunHistoryList
        activeRunHistoryRows={activeRunHistoryRows}
        assignRunHistoryCompareRole={assignRunHistoryCompareRole}
        formatTimestamp={formatTimestamp}
        isBusy={isBusy}
        loadRunHistoryIntoEditor={loadRunHistoryIntoEditor}
        pinRunHistoryAsSavedView={pinRunHistoryAsSavedView}
        replayRunHistory={replayRunHistory}
        resetRunHistoryFilters={resetRunHistoryFilters}
        runHistoryCompareSelection={runHistoryCompareSelection}
        runHistoryRowId={runHistoryRowId}
        runHistoryTotalCount={runHistoryTotalCount}
        selectedRunHistoryRow={selectedRunHistoryRow}
        setSelectedRunHistoryId={setSelectedRunHistoryId}
        toggleRunHistoryPinnedState={toggleRunHistoryPinnedState}
      />
      <RunHistoryComparePanel
        clearRunHistoryCompare={clearRunHistoryCompare}
        compareBaseRunHistoryRow={compareBaseRunHistoryRow}
        compareTargetRunHistoryRow={compareTargetRunHistoryRow}
        requestRunHistoryCompareDiffExport={requestRunHistoryCompareDiffExport}
        runHistoryCompareDiff={runHistoryCompareDiff}
        runHistoryCompareSelection={runHistoryCompareSelection}
        swapRunHistoryCompareRoles={swapRunHistoryCompareRoles}
      />
      <RunHistoryDetailsPanel
        activeCaseLibraryEntry={activeCaseLibraryEntry}
        activeCaseLibraryId={activeCaseLibraryId}
        caseBundleMode={caseBundleMode}
        caseNotesDraft={caseNotesDraft}
        copyRunDetailsSection={copyRunDetailsSection}
        errorDetailsPreview={errorDetailsPreview}
        formatTimestamp={formatTimestamp}
        inputDetailsPreview={inputDetailsPreview}
        outputDetailsPreview={outputDetailsPreview}
        renderedErrorDetailsText={renderedErrorDetailsText}
        renderedInputDetailsText={renderedInputDetailsText}
        renderedOutputDetailsText={renderedOutputDetailsText}
        requestRunExportReview={requestRunExportReview}
        runDetailsExpanded={runDetailsExpanded}
        runHistoryDetailsHeadingRef={runHistoryDetailsHeadingRef}
        runHistoryErrors={runHistoryErrors}
        saveActiveCaseNotes={saveActiveCaseNotes}
        saveCurrentCaseToLibrary={saveCurrentCaseToLibrary}
        selectedRunDetails={selectedRunDetails}
        setCaseNotesDraft={setCaseNotesDraft}
        toggleRunDetailsExpandedSection={toggleRunDetailsExpandedSection}
      />
    </section>
  );
}

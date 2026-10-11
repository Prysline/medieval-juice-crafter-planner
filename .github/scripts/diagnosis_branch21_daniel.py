import json
import os
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

import diagnosis_branch21_charles as base
import diagnosis_branch21_ivo as ivo
import diagnosis_branch21_post_nicholas as post

NAMES = ivo.NAMES
SUBSETS = ivo.SUBSETS
ROUTED = 'gavinus'
RESOLVED_SPARSE = 'ivo'
SPARSE = 'daniel'
RUN_ID = 38118106345
AUDIT_ARTIFACT_ID = 11694169828
HISTORY_KEYS = [
    'newlyExactClosedPostNicholasBranches', 'exactClosedNicholasBranches',
    'exactClosedGonzaloBranches', 'exactClosedWilliamBranches',
    'exactClosedEmerysBranches', 'exactClosedChristinaBranches',
    'exactClosedTacyBranches', 'exactClosedUlbertBranches',
    'exactClosedMarthaBranches', 'siblingFrotgaParentBranchCount',
    'exactClosedIvoBranches',
]
DANIEL = [
    45,50,91,193,200,203,205,206,266,281,292,301,308,339,430,448,461,465,469,
    509,582,583,609,626,641,653,658,663,676,696,699,709,821,825,829,833,961,
    1008,1009,1011,1013,1015,1016,1022,1026,1065,1074,1081,1091,1094,1097,
    1102,1104,1114,1126,1129,1131,1144,1145,1147,1150,1156,1158,1159,1162,
    1164,1166,1167,1170,1186,1189,1195,1198,1201,1206,1210,1213,1301,1308,
    1312,1322,1324,1330,1331,1333,1335,1338,1341,1344,1347,1349,
]
DANIEL_PARTS = [DANIEL[:45], DANIEL[45:]]


def _validate_parent(branch):
    assert isinstance(branch, list) and len(branch) == 22
    assert all(isinstance(value, int) for value in branch[:7])
    assert all(value in (0, 1) for value in branch[7:])
    prior_bits = branch[7:20]
    routed_bit = branch[20]
    ivo_bit = branch[21]
    assert len(prior_bits) == len(NAMES) == 13
    return branch[:7], prior_bits, routed_bit, ivo_bit


def prepare():
    audit = json.loads(Path('ivo-routing-audit/identity-334-ivo-residual-routing-audit.json').read_text())
    assert audit['complete'] is True
    assert audit['sourceIvoBinaryExactRunId'] == 38112733603
    assert audit['sourceIvoBinaryExactAuditArtifactId'] == 11692534917
    assert audit['expectedBranches'] == audit['observedBranches'] == 5051
    assert audit['missingBranches'] == audit['unexpectedBranches'] == audit['duplicateBranches'] == audit['malformed'] == []
    assert audit['outerFailures'] == audit['outerTimeouts'] == 0
    assert audit['routedSparseCustomer'] == ROUTED
    assert audit['resolvedSparseCustomer'] == RESOLVED_SPARSE
    assert audit['sparseCustomerCounts'] == {SPARSE: 5051}
    signatures = audit['routingSignatures']
    assert signatures == [{
        'branchCount': 5051,
        'nextSparseCustomer': SPARSE,
        'candidates': [{'groupIndex': group_index, 'slackOnly': False} for group_index in DANIEL],
    }]
    assert len(DANIEL) == 91
    assert [len(part) for part in DANIEL_PARTS] == [45, 46]
    assert set(DANIEL_PARTS[0]).isdisjoint(DANIEL_PARTS[1])
    assert set(DANIEL_PARTS[0]) | set(DANIEL_PARTS[1]) == set(DANIEL)

    parents = audit['routedParents']
    assert len(parents) == len({tuple(item['branch']) for item in parents}) == 5051
    for item in parents:
        _validate_parent(item['branch'])
        assert item['nextSparseCustomer'] == SPARSE
    selected = sorted(({'branch': item['branch']} for item in parents), key=lambda item: item['branch'])
    out = {
        'sourceIvoResidualRoutingRunId': RUN_ID,
        'sourceIvoResidualRoutingAuditArtifactId': AUDIT_ARTIFACT_ID,
        'routedSparseCustomer': ROUTED,
        'resolvedSparseCustomer': RESOLVED_SPARSE,
        'sparseCustomer': SPARSE,
        'candidateGroups': DANIEL,
        'subsets': DANIEL_PARTS,
        'parentBranches': selected,
        'deferredPaulineRouteParentCount': audit['deferredPaulineRouteParentCount'],
        **{key: audit[key] for key in HISTORY_KEYS},
    }
    Path('identity-334-daniel-binary-exact-source.json').write_text(json.dumps(out, indent=2, sort_keys=True) + '\n')
    sizes = [len(selected[(i - 1) * 20:i * 20]) for i in range(1, 254)]
    assert sizes[:-1] == [20] * 252 and sizes[-1] == 11 and sum(sizes) == 5051
    print('matrix=' + json.dumps({'include': [{'shard': i} for i in range(1, 254)]}, separators=(',', ':')))


def run_shard():
    path = Path('src/domain/optimizerMachineContinuationProfile.test.ts')
    original = path.read_text()
    patched, start, end, test = base.patch_source(original)
    parents = json.loads(os.environ['SHARD_PARENTS'])
    assert 1 <= len(parents) <= 20
    ansi = re.compile(r'\x1b\[[0-9;]*m')
    marker = '[machine-extra1-pair-daniel-binary-result] '
    results, failed, ordinal = [], False, 0
    scalar_names = ['octavius','oliver','hugo','tiffany','dominic','heloise','solomon']
    for item in parents:
        parent = item['branch']
        scalars, bits, routed_bit, ivo_bit = _validate_parent(parent)
        prior = [parts[bit] for parts, bit in zip(SUBSETS, bits)]
        routed_subset = post.ROUTED_SUBSETS[ROUTED][routed_bit]
        ivo_subset = ivo.IVO_PARTS[ivo_bit]
        for daniel_bit, daniel_subset in enumerate(DANIEL_PARTS):
            ordinal += 1
            lines = [
                '', '    const fixedExactGroupIndex = 334',
                '    const fixedExactCustomerSet = new Set(groups[fixedExactGroupIndex].eligibleCustomerIds)',
                '    const fixedExactCustomers = [...fixedExactCustomerSet]',
                '    const requiredPair = [1052, 1070] as const',
                '    const saviusChoice = 692', '    const ambrosiaChoice = 1243',
            ]
            lines += [f'    const {name}Choice = {value}' for name, value in zip(scalar_names, scalars)]
            for name, bit, subset in zip(NAMES, bits, prior):
                lines += [f'    const {name}SplitIndex = {bit}', f'    const {name}Subset = {json.dumps(subset,separators=(",",":"))} as const']
            lines += [
                f"    const routedSparseCustomer = '{ROUTED}'",
                f'    const routedSplitIndex = {routed_bit}',
                f'    const routedSubset = {json.dumps(routed_subset,separators=(",",":"))} as const',
                f"    const resolvedSparseCustomer = '{RESOLVED_SPARSE}'",
                f'    const ivoSplitIndex = {ivo_bit}',
                f'    const ivoSubset = {json.dumps(ivo_subset,separators=(",",":"))} as const',
                f"    const sparseCustomer = '{SPARSE}'",
                f'    const danielSplitIndex = {daniel_bit}',
                f'    const danielSubset = {json.dumps(daniel_subset,separators=(",",":"))} as const',
            ]
            lines += [f"    {name}Subset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('{name}'))" for name in NAMES]
            lines += [
                '    routedSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain(routedSparseCustomer))',
                '    ivoSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain(resolvedSparseCustomer))',
                '    danielSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain(sparseCustomer))',
            ]
            required_any = ', '.join([*(f'{name}Subset' for name in NAMES), 'routedSubset', 'ivoSubset', 'danielSubset'])
            identity = ', '.join(f'{name}SplitIndex, {name}Subset' for name in NAMES)
            scalar_refs = ', '.join(f'{name}Choice' for name in scalar_names)
            lines += [
                '    const thresholdCounts = [3, 1, 1, 0] as const',
                '    const supportCuts: number[][] = []', "    let status = 'round-limit'",
                '    let masterSolveMs = 0', '    let exactSolveMs = 0',
                '    let exactInfeasibleSupports = 0', '    let fixedSupportExactAttempts = 0',
                '    for (let round = 0; round < 16; round += 1) {',
                f'      const built = build311ExtraCostSumSupportMaster(domain, fixedExactGroupIndex, 89, {{ supportCuts, includeCustomerFlow: true, forcedCustomerIds: fixedExactCustomers, requiredUsedGroupIndexes: [fixedExactGroupIndex, ...requiredPair, saviusChoice, ambrosiaChoice, {scalar_refs}], requiredAnyUsedGroupIndexSets: [{required_any}], requiredExtraOneGroupIndexes: [...requiredPair] }})',
                '      const solved = await solveBounded(built.model, 0.5)',
                '      masterSolveMs += solved.solveMs',
                "      if (solved.status === 'infeasible') { status = 'infeasible'; break }",
                "      if (solved.status !== 'optimal' || !solved.namedSolution) { status = solved.status; break }",
                "      const support = groups.flatMap((_group, groupIndex) => { const raw = solved.namedSolution!.get(`s31su_${groupIndex}`); return typeof raw === 'number' && Number.isFinite(raw) && raw > 0.5 ? [groupIndex] : [] })",
                "      if (support.length !== 30) throw new Error(`Expected 30 support groups, got ${support.length}`)",
                "      const exact = buildFinalizing30MaskPartitionStage(domain, new Set<ProductionStepKind>(['juicing', 'seasoning', 'blending']), thresholdCounts, { max: 76 }, 0, new Set(support))",
                '      fixedSupportExactAttempts += 1', '      const exactSolved = await solveBounded(exact.model, 3)',
                '      exactSolveMs += exactSolved.solveMs',
                "      if (exactSolved.status === 'infeasible') { exactInfeasibleSupports += 1; supportCuts.push(support); status = 'exact-infeasible-support'; continue }",
                "      if (exactSolved.status === 'optimal') { status = 'global-witness'; break }",
                "      status = `exact-${exactSolved.status}`", '      break', '    }',
                f"    console.info('{marker.strip()}', JSON.stringify({{ fixedGroupIndex: fixedExactGroupIndex, extraOneCostSum: 89, companionCost: 53, pair: requiredPair, saviusChoice, ambrosiaChoice, {scalar_refs}, {identity}, routedSparseCustomer, routedSplitIndex, routedSubset, resolvedSparseCustomer, ivoSplitIndex, ivoSubset, sparseCustomer, danielSplitIndex, danielSubset, status, supportCuts: supportCuts.length, exactInfeasibleSupports, fixedSupportExactAttempts, masterSolveMs: Math.round(masterSolveMs), exactSolveMs: Math.round(exactSolveMs) }}))",
            ]
            path.write_text(patched[:start] + test + '\n'.join(lines) + patched[end:])
            cmd = ['npx','vitest','run',str(path),'--maxWorkers=1','--minWorkers=1','-t',r'profiles Hall-closure membership signatures for unresolved 3\+1\+1 support']
            try:
                done = subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=180)
                text, code, timed = done.stdout, done.returncode, False
            except subprocess.TimeoutExpired as exc:
                text = (exc.stdout or '') if isinstance(exc.stdout, str) else (exc.stdout or b'').decode(errors='replace')
                code, timed = 124, True
            Path(f'branch-{ordinal}.log').write_text(text)
            marked = [ansi.sub('', line) for line in text.splitlines() if marker in ansi.sub('', line)]
            entry = {'branch': parent + [daniel_bit], 'routedSparseCustomer': ROUTED, 'resolvedSparseCustomer': RESOLVED_SPARSE, 'sparseCustomer': SPARSE, 'outerReturnCode': code, 'outerTimeout': timed, 'markerCount': len(marked), 'solver': None}
            if len(marked) == 1:
                entry['solver'] = json.loads(marked[0][marked[0].find(marker) + len(marker):])
            failed |= code != 0 or len(marked) != 1
            results.append(entry)
    path.write_text(original)
    Path('exact-results.json').write_text(json.dumps(results, indent=2, sort_keys=True) + '\n')
    if failed:
        raise SystemExit('one or more Daniel binary exact branches failed')


def audit():
    src = json.loads(Path('daniel-source/identity-334-daniel-binary-exact-source.json').read_text())
    assert src['sourceIvoResidualRoutingRunId'] == RUN_ID
    assert src['sourceIvoResidualRoutingAuditArtifactId'] == AUDIT_ARTIFACT_ID
    assert src['routedSparseCustomer'] == ROUTED and src['resolvedSparseCustomer'] == RESOLVED_SPARSE and src['sparseCustomer'] == SPARSE
    assert src['candidateGroups'] == DANIEL and src['subsets'] == DANIEL_PARTS
    assert src['deferredPaulineRouteParentCount'] == 5031
    parents = src['parentBranches']
    assert len(parents) == len({tuple(x['branch']) for x in parents}) == 5051
    for item in parents:
        _validate_parent(item['branch'])
    expected = {tuple(x['branch'] + [bit]) for x in parents for bit in (0, 1)}
    files = list(Path('exact-shards').rglob('exact-results.json'))
    results, duplicates, malformed = {}, [], []
    failures = timeouts = cuts = exact_infeasible_supports = attempts = exact_ms = 0
    statuses, by_status, witnesses, sizes = Counter(), {}, [], []
    if len(files) != 253:
        malformed.append({'reason': 'shard-result-count', 'count': len(files)})
    for file in files:
        entries = json.loads(file.read_text())
        sizes.append(len(entries))
        if not 2 <= len(entries) <= 40 or len(entries) % 2:
            malformed.append({'reason': 'branch-count', 'path': str(file), 'count': len(entries)})
        for entry in entries:
            branch = entry.get('branch')
            if not isinstance(branch, list) or len(branch) != 23 or any(v not in (0, 1) for v in branch[7:]):
                malformed.append({'reason': 'branch-shape', 'branch': branch}); continue
            if entry.get('routedSparseCustomer') != ROUTED or entry.get('resolvedSparseCustomer') != RESOLVED_SPARSE or entry.get('sparseCustomer') != SPARSE:
                malformed.append({'reason': 'route-identity', 'branch': branch}); continue
            key = tuple(branch)
            if key in results:
                duplicates.append(branch); continue
            results[key] = entry
            failures += entry.get('outerReturnCode') != 0
            timeouts += bool(entry.get('outerTimeout'))
            solver = entry.get('solver')
            if not isinstance(solver, dict):
                malformed.append({'reason': 'missing-solver', 'branch': branch}); continue
            ok = solver.get('routedSparseCustomer') == ROUTED and solver.get('resolvedSparseCustomer') == RESOLVED_SPARSE and solver.get('sparseCustomer') == SPARSE
            for name, parts, bit in zip(NAMES, SUBSETS, branch[7:20]):
                ok &= solver.get(f'{name}SplitIndex') == bit and solver.get(f'{name}Subset') == parts[bit]
            routed_bit, ivo_bit, daniel_bit = branch[20], branch[21], branch[22]
            ok &= solver.get('routedSplitIndex') == routed_bit and solver.get('routedSubset') == post.ROUTED_SUBSETS[ROUTED][routed_bit]
            ok &= solver.get('ivoSplitIndex') == ivo_bit and solver.get('ivoSubset') == ivo.IVO_PARTS[ivo_bit]
            ok &= solver.get('danielSplitIndex') == daniel_bit and solver.get('danielSubset') == DANIEL_PARTS[daniel_bit]
            if not ok:
                malformed.append({'reason': 'solver-identity', 'branch': branch})
            status = solver.get('status')
            if not isinstance(status, str):
                malformed.append({'reason': 'solver-status', 'branch': branch}); continue
            statuses[status] += 1; by_status.setdefault(status, []).append(branch)
            cuts += int(solver.get('supportCuts') or 0)
            exact_infeasible_supports += int(solver.get('exactInfeasibleSupports') or 0)
            attempts += int(solver.get('fixedSupportExactAttempts') or 0)
            exact_ms += int(solver.get('exactSolveMs') or 0)
            if status == 'global-witness': witnesses.append(branch)
    if Counter(sizes) != Counter({40: 252, 22: 1}):
        malformed.append({'reason': 'shard-size-distribution', 'counts': dict(sorted(Counter(sizes).items()))})
    observed = set(results)
    report = {
        'complete': expected == observed and not duplicates and not malformed and failures == 0 and timeouts == 0,
        'sourceIvoResidualRoutingRunId': RUN_ID,
        'sourceIvoResidualRoutingAuditArtifactId': AUDIT_ARTIFACT_ID,
        'splitKind': 'route-required-any-used-binary',
        'routedSparseCustomer': ROUTED, 'resolvedSparseCustomer': RESOLVED_SPARSE, 'sparseCustomer': SPARSE,
        'danielCandidateGroups': DANIEL, 'danielSubsets': DANIEL_PARTS, 'parentBranchCount': len(parents),
        **{key: src[key] for key in HISTORY_KEYS},
        'deferredPaulineRouteParentCount': src['deferredPaulineRouteParentCount'],
        'expectedBranches': len(expected), 'observedBranches': len(observed),
        'missingBranches': [list(x) for x in sorted(expected - observed)],
        'unexpectedBranches': [list(x) for x in sorted(observed - expected)],
        'duplicateBranches': duplicates, 'malformed': malformed,
        'outerFailures': failures, 'outerTimeouts': timeouts, 'statuses': dict(sorted(statuses.items())),
        'exactInfeasibleBranches': statuses.get('infeasible', 0), 'masterTimeoutBranches': statuses.get('timelimit', 0),
        'roundLimitBranches': statuses.get('round-limit', 0),
        'fixedSupportTimeoutBranches': sum(n for s, n in statuses.items() if s.startswith('exact-') and s.endswith('timelimit')),
        'supportCuts': cuts, 'exactInfeasibleSupports': exact_infeasible_supports,
        'fixedSupportExactAttempts': attempts, 'exactSolveMs': exact_ms,
        'witnessCount': len(witnesses), 'globalWitnessCount': len(witnesses), 'witnesses': witnesses,
        'branchesByStatus': {s: sorted(v) for s, v in sorted(by_status.items())},
    }
    Path('identity-334-daniel-binary-exact-audit.json').write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    print(json.dumps({k: report[k] for k in ['complete','expectedBranches','observedBranches','statuses','outerFailures','outerTimeouts','witnessCount']}, sort_keys=True))
    if not report['complete']:
        raise SystemExit(1)


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    {'prepare': prepare, 'run': run_shard, 'audit': audit}.get(mode, lambda: (_ for _ in ()).throw(SystemExit('usage: diagnosis_branch21_daniel.py prepare|run|audit')))()

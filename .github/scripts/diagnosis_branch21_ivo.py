import json
import os
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

import diagnosis_branch21_charles as base
import diagnosis_branch21_post_nicholas as prev

NAMES = prev.PRIOR_SPLIT_NAMES
SUBSETS = prev.PRIOR_SPLIT_SUBSETS
ROUTED = 'gavinus'
SPARSE = 'ivo'
RUN_ID = 38104396220
SOURCE_ARTIFACT_ID = 11688309816
AUDIT_ARTIFACT_ID = 11690685514
PARENT_COUNTS = {'gavinus': 3474, 'pauline': 5031}
ROUTE_COUNTS = {('gavinus', 'ivo'): 3474, ('pauline', 'gavinus'): 5031}
HISTORY_KEYS = [
    'newlyExactClosedPostNicholasBranches', 'exactClosedNicholasBranches',
    'exactClosedGonzaloBranches', 'exactClosedWilliamBranches',
    'exactClosedEmerysBranches', 'exactClosedChristinaBranches',
    'exactClosedTacyBranches', 'exactClosedUlbertBranches',
    'exactClosedMarthaBranches', 'siblingFrotgaParentBranchCount',
]
IVO = [
    110,115,249,250,251,252,269,311,315,321,322,372,411,412,413,414,415,442,
    740,745,778,779,780,781,832,834,835,841,842,843,844,849,852,853,856,926,
    966,968,1031,1032,1033,1034,1047,1068,1069,1072,1083,1084,1085,1096,1097,
    1098,1099,1101,1218,1219,1228,1229,1230,1239,1241,1242,1247,1248,1249,
    1250,1251,1260,1261,1262,1279,1280,1284,1285,1286,1287,1288,1289,1290,
    1291,1292,1302,1303,1304,1305,1307,1310,1311,
]
IVO_PARTS = [IVO[:44], IVO[44:]]


def _parent_key(entry):
    branch = entry['branch']
    routed = entry['sparseCustomer']
    assert routed in PARENT_COUNTS and len(branch) == 21
    assert all(v in (0, 1) for v in branch[7:])
    return routed, tuple(branch[7:20]), branch[20]


def _signature_key(sig):
    routed = sig['routedSparseCustomer']
    bits = tuple(sig[f'{name}SplitIndex'] for name in NAMES)
    bit = sig['routedSplitIndex']
    assert routed in PARENT_COUNTS and len(bits) == 13
    assert all(v in (0, 1) for v in bits) and bit in (0, 1)
    return routed, bits, bit


def _candidates(sig):
    values = sig['candidates']
    assert isinstance(values, list) and all(x.get('slackOnly') is False for x in values)
    return [x['groupIndex'] for x in values]


def prepare():
    src = json.loads(Path('post-nicholas-routing-source/identity-334-post-nicholas-residual-routing-source.json').read_text())
    audit = json.loads(Path('post-nicholas-routing-audit/identity-334-post-nicholas-residual-routing-audit.json').read_text())
    assert src['sourcePostNicholasExactRunId'] == 38070874020
    assert src['sourcePostNicholasExactAuditArtifactId'] == 11678832876
    assert src['statuses'] == {'infeasible': 2375, 'timelimit': 8505}
    assert src['routedParentCounts'] == PARENT_COUNTS
    parents = src['parentBranches']
    assert len(parents) == len({(tuple(x['branch']), x['sparseCustomer']) for x in parents}) == 8505
    assert audit['complete'] is True
    assert audit['sourcePostNicholasExactRunId'] == 38070874020
    assert audit['sourcePostNicholasExactAuditArtifactId'] == 11678832876
    assert audit['expectedBranches'] == audit['observedBranches'] == 8505
    assert audit['missingBranches'] == audit['unexpectedBranches'] == audit['duplicateBranches'] == audit['malformed'] == []
    assert audit['outerFailures'] == 0 and audit['routedParentCounts'] == PARENT_COUNTS
    assert audit['sparseCustomerCounts'] == {'gavinus': 5031, 'ivo': 3474}

    source_counts = Counter(_parent_key(x) for x in parents)
    audit_counts, routes, seen = Counter(), Counter(), set()
    for sig in audit['routingSignatures']:
        key = _signature_key(sig)
        assert key not in seen
        seen.add(key)
        route = (sig['routedSparseCustomer'], sig['sparseCustomer'])
        routes[route] += sig['branchCount']
        audit_counts[key] += sig['branchCount']
        candidates = _candidates(sig)
        if route == ('gavinus', 'ivo'):
            assert candidates == IVO
        elif route == ('pauline', 'gavinus'):
            assert candidates == prev.GAVINUS_CHOICES
        else:
            raise AssertionError(route)
    assert source_counts == audit_counts and routes == Counter(ROUTE_COUNTS)
    assert len(seen) == 7735
    assert [len(x) for x in IVO_PARTS] == [44, 44]
    assert set(IVO_PARTS[0]).isdisjoint(IVO_PARTS[1]) and set(IVO_PARTS[0]) | set(IVO_PARTS[1]) == set(IVO)

    selected = [
        {'branch': x['branch'], 'routedSparseCustomer': x['sparseCustomer']}
        for x in parents if x['sparseCustomer'] == ROUTED
    ]
    selected.sort(key=lambda x: x['branch'])
    assert len(selected) == 3474
    out = {
        'sourcePostNicholasResidualRoutingRunId': RUN_ID,
        'sourcePostNicholasResidualRoutingSourceArtifactId': SOURCE_ARTIFACT_ID,
        'sourcePostNicholasResidualRoutingAuditArtifactId': AUDIT_ARTIFACT_ID,
        'routedSparseCustomer': ROUTED, 'sparseCustomer': SPARSE,
        'candidateGroups': IVO, 'subsets': IVO_PARTS, 'parentBranches': selected,
        'deferredPaulineRouteParentCount': 5031,
        **{key: audit[key] for key in HISTORY_KEYS},
    }
    Path('identity-334-ivo-binary-exact-source.json').write_text(json.dumps(out, indent=2, sort_keys=True) + '\n')
    sizes = [len(selected[(i - 1) * 16:i * 16]) for i in range(1, 219)]
    assert sizes[:-1] == [16] * 217 and sizes[-1] == 2 and sum(sizes) == 3474
    print('matrix=' + json.dumps({'include': [{'shard': i} for i in range(1, 219)]}, separators=(',', ':')))


def run_shard():
    path = Path('src/domain/optimizerMachineContinuationProfile.test.ts')
    original = path.read_text()
    patched, start, end, test = base.patch_source(original)
    parents = json.loads(os.environ['SHARD_PARENTS'])
    assert 1 <= len(parents) <= 16
    ansi = re.compile(r'\x1b\[[0-9;]*m')
    marker = '[machine-extra1-pair-ivo-binary-result] '
    results, failed, ordinal = [], False, 0
    for item in parents:
        parent = item['branch']
        assert item['routedSparseCustomer'] == ROUTED
        assert len(parent) == 21 and all(v in (0, 1) for v in parent[7:])
        scalars, bits, routed_bit = parent[:7], parent[7:20], parent[20]
        prior = [parts[bit] for parts, bit in zip(SUBSETS, bits)]
        routed_subset = prev.ROUTED_SUBSETS[ROUTED][routed_bit]
        for ivo_bit, ivo_subset in enumerate(IVO_PARTS):
            ordinal += 1
            scalar_names = ['octavius','oliver','hugo','tiffany','dominic','heloise','solomon']
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
                f"    const sparseCustomer = '{SPARSE}'", f'    const ivoSplitIndex = {ivo_bit}',
                f'    const ivoSubset = {json.dumps(ivo_subset,separators=(",",":"))} as const',
            ]
            lines += [f"    {name}Subset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain('{name}'))" for name in NAMES]
            lines += [
                '    routedSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain(routedSparseCustomer))',
                '    ivoSubset.forEach((groupIndex) => expect(groups[groupIndex].eligibleCustomerIds).toContain(sparseCustomer))',
            ]
            required_any = ', '.join([*(f'{name}Subset' for name in NAMES), 'routedSubset', 'ivoSubset'])
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
                f"    console.info('{marker.strip()}', JSON.stringify({{ fixedGroupIndex: fixedExactGroupIndex, extraOneCostSum: 89, companionCost: 53, pair: requiredPair, saviusChoice, ambrosiaChoice, {scalar_refs}, {identity}, routedSparseCustomer, routedSplitIndex, routedSubset, sparseCustomer, ivoSplitIndex, ivoSubset, status, supportCuts: supportCuts.length, exactInfeasibleSupports, fixedSupportExactAttempts, masterSolveMs: Math.round(masterSolveMs), exactSolveMs: Math.round(exactSolveMs) }}))",
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
            entry = {'branch': parent + [ivo_bit], 'routedSparseCustomer': ROUTED, 'sparseCustomer': SPARSE, 'outerReturnCode': code, 'outerTimeout': timed, 'markerCount': len(marked), 'solver': None}
            if len(marked) == 1:
                entry['solver'] = json.loads(marked[0][marked[0].find(marker) + len(marker):])
            failed |= code != 0 or len(marked) != 1
            results.append(entry)
    path.write_text(original)
    Path('exact-results.json').write_text(json.dumps(results, indent=2, sort_keys=True) + '\n')
    if failed:
        raise SystemExit('one or more Ivo binary exact branches failed')


def audit():
    src = json.loads(Path('ivo-source/identity-334-ivo-binary-exact-source.json').read_text())
    assert src['sourcePostNicholasResidualRoutingRunId'] == RUN_ID
    assert src['sourcePostNicholasResidualRoutingSourceArtifactId'] == SOURCE_ARTIFACT_ID
    assert src['sourcePostNicholasResidualRoutingAuditArtifactId'] == AUDIT_ARTIFACT_ID
    assert src['routedSparseCustomer'] == ROUTED and src['sparseCustomer'] == SPARSE
    assert src['candidateGroups'] == IVO and src['subsets'] == IVO_PARTS
    assert src['deferredPaulineRouteParentCount'] == 5031
    parents = src['parentBranches']
    assert len(parents) == len({tuple(x['branch']) for x in parents}) == 3474
    assert all(x['routedSparseCustomer'] == ROUTED and len(x['branch']) == 21 and all(v in (0, 1) for v in x['branch'][7:]) for x in parents)
    expected = {tuple(x['branch'] + [bit]) for x in parents for bit in (0, 1)}
    files = list(Path('exact-shards').rglob('exact-results.json'))
    results, duplicates, malformed = {}, [], []
    failures = timeouts = cuts = exact_infeasible_supports = attempts = exact_ms = 0
    statuses, by_status, witnesses, sizes = Counter(), {}, [], []
    if len(files) != 218:
        malformed.append({'reason': 'shard-result-count', 'count': len(files)})
    for file in files:
        entries = json.loads(file.read_text())
        sizes.append(len(entries))
        if not 2 <= len(entries) <= 32 or len(entries) % 2:
            malformed.append({'reason': 'branch-count', 'path': str(file), 'count': len(entries)})
        for entry in entries:
            branch = entry.get('branch')
            if not isinstance(branch, list) or len(branch) != 22 or any(v not in (0, 1) for v in branch[7:]):
                malformed.append({'reason': 'branch-shape', 'branch': branch}); continue
            if entry.get('routedSparseCustomer') != ROUTED or entry.get('sparseCustomer') != SPARSE:
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
            ok = solver.get('routedSparseCustomer') == ROUTED and solver.get('sparseCustomer') == SPARSE
            for name, parts, bit in zip(NAMES, SUBSETS, branch[7:20]):
                ok &= solver.get(f'{name}SplitIndex') == bit and solver.get(f'{name}Subset') == parts[bit]
            routed_bit, ivo_bit = branch[20], branch[21]
            ok &= solver.get('routedSplitIndex') == routed_bit and solver.get('routedSubset') == prev.ROUTED_SUBSETS[ROUTED][routed_bit]
            ok &= solver.get('ivoSplitIndex') == ivo_bit and solver.get('ivoSubset') == IVO_PARTS[ivo_bit]
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
    if Counter(sizes) != Counter({32: 217, 4: 1}):
        malformed.append({'reason': 'shard-size-distribution', 'counts': dict(sorted(Counter(sizes).items()))})
    observed = set(results)
    report = {
        'complete': expected == observed and not duplicates and not malformed and failures == 0 and timeouts == 0,
        'sourcePostNicholasResidualRoutingRunId': RUN_ID,
        'sourcePostNicholasResidualRoutingSourceArtifactId': SOURCE_ARTIFACT_ID,
        'sourcePostNicholasResidualRoutingAuditArtifactId': AUDIT_ARTIFACT_ID,
        'splitKind': 'route-required-any-used-binary', 'routedSparseCustomer': ROUTED, 'sparseCustomer': SPARSE,
        'ivoCandidateGroups': IVO, 'ivoSubsets': IVO_PARTS, 'parentBranchCount': len(parents),
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
    Path('identity-334-ivo-binary-exact-audit.json').write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    print(json.dumps({k: report[k] for k in ['complete','expectedBranches','observedBranches','statuses','outerFailures','outerTimeouts','witnessCount']}, sort_keys=True))
    if not report['complete']:
        raise SystemExit(1)


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    {'prepare': prepare, 'run': run_shard, 'audit': audit}.get(mode, lambda: (_ for _ in ()).throw(SystemExit('usage: diagnosis_branch21_ivo.py prepare|run|audit')))()

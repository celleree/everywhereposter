"""Write a new owned-input manifest; the existing renderer stays offline."""
import argparse,copy,json
from pathlib import Path
from cache import ready,sha
from contract import validate,checked_policy

def compose(manifest,request,policy,cache):
    key=validate(request,checked_policy(policy));asset=ready(cache,key)
    if not asset: raise ValueError('asset_not_ready')
    if request['use']=='evidence' and request.get('contentVerified') is not True: raise ValueError('content_review_required')
    result=copy.deepcopy(manifest);p=result['project']
    if p['id']!=request['projectId'] or p['revision']!=request['revision'] or request['anchorWord'] not in {w['id'] for w in p['words']}: raise ValueError('project_revision_or_anchor_mismatch')
    start=request['outputFrom'];frames=round(asset['facts']['duration']*p['canvas']['fps']);total=sum(c['out']-c['in'] for c in p['cuts'])
    if start+frames>total or p['canvas']['fps']!=30 or any(start<b['from']+b['frames'] and start+frames>b['from'] for b in p['broll']): raise ValueError('invalid_broll_placement')
    anchor=next(w for w in p['words'] if w['id']==request['anchorWord'])
    if abs(start/p['canvas']['fps']-anchor['start'])>2: raise ValueError('detached_narration_anchor')
    aid=asset['assetId']
    if any(a['id']==aid for a in p['assets']): raise ValueError('asset_already_registered')
    p['revision']+=1
    p['assets'].append({'id':aid,'kind':'video','file':f'assets/{aid}.mp4','sha256':asset['sha256'],
                       **{k:asset['facts'][k] for k in ['duration','fps','width','height']},
                       'evidence':(request['context']+'; '+request['rights']['attribution'])[:1000]})
    p['broll'].append({'id':'broll-'+key[:24],'assetId':aid,'from':start,'frames':frames,'sourceStart':0,
                       'anchorWords':[request['anchorWord']],'reason':request['context'][:1000]})
    result['inputs']['assets'].append({'id':aid,'path':asset['path'],'sha256':asset['sha256']})
    receipt=Path(cache)/key/'receipt.json'
    result['provenance'].setdefault('acquiredAssets',{})[aid]={'receiptPath':str(receipt.resolve()),'receiptSha256':sha(receipt),'rightsDigest':asset['rightsDigest']}
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser()
    for k in ['manifest','request','policy','cache','output']: p.add_argument('--'+k,required=True)
    a=p.parse_args()
    try:
        result=compose(json.loads(Path(a.manifest).read_text()),json.loads(Path(a.request).read_text()),json.loads(Path(a.policy).read_text()),a.cache)
        with open(a.output,'x') as f: json.dump(result,f,indent=2);f.write('\n')
    except Exception: raise SystemExit('Manifest handoff failed; no accepted output')

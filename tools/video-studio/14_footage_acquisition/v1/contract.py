"""Trusted worker-internal requests, never a public raw-path/URL API."""
import hashlib, ipaddress, json, re
from urllib.parse import urlsplit

LIMITS = dict(trafficBytes=250*1024**2, assetBytes=100*1024**2,
              sourceSeconds=600, coverageSeconds=30, acquisitionSeconds=120,
              normalizeSeconds=60, connections=64)

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

def hostname(value):
    if not isinstance(value, str) or len(value)>253 or not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?',value):
        raise ValueError('blocked_url')
    try: ipaddress.ip_address(value)
    except ValueError: pass
    else: raise ValueError('blocked_url')
    if '.' not in value or any(not s or len(s)>63 or s.startswith('-') or s.endswith('-') for s in value.split('.')):
        raise ValueError('blocked_url')
    return value

def public_ipv4(value):
    a=ipaddress.ip_address(value)
    return a.version==4 and a.is_global and not (a.is_multicast or a.is_reserved)

def validate(request, policy):
    if set(request)-{'schemaVersion','requestId','projectId','revision','authorizationScope','context','anchorWord','use','rights','url','interval','outputFrom','contentVerified'}: raise ValueError('invalid_request')
    if request.get('schemaVersion')!=1: raise ValueError('invalid_request')
    for key in ['requestId','projectId','authorizationScope','context','anchorWord']:
        if not isinstance(request.get(key),str) or not request[key].strip() or len(request[key])>2000:
            raise ValueError('invalid_request')
    if request.get('use') not in ['illustrative','evidence']: raise ValueError('invalid_request')
    rights=request.get('rights',{})
    if rights.get('status')!='approved' or rights.get('scope')!=request['authorizationScope'] or rights.get('basis') not in ['owned','licensed','permission','public-domain']:
        raise ValueError('rights_missing')
    if any(not isinstance(rights.get(k),str) or not rights[k].strip() for k in ['evidence','attribution']): raise ValueError('rights_missing')
    url=request.get('url','')
    if not isinstance(url,str) or len(url)>4096 or any(ord(c)<33 for c in url) or '\\' in url: raise ValueError('blocked_url')
    u=urlsplit(url)
    if u.scheme!='https' or u.username or u.password or u.port not in [None,443] or u.fragment or '%' in u.netloc:
        raise ValueError('blocked_url')
    host=hostname(u.hostname or '')
    if host not in policy['hosts']: raise ValueError('blocked_url')
    interval=request.get('interval')
    if not isinstance(interval,list) or len(interval)!=2 or any(type(x) not in [int,float] or not 0<=x<=policy['sourceSeconds'] for x in interval) or not 0<interval[1]-interval[0]<=policy['coverageSeconds']:
        raise ValueError('invalid_interval')
    if not isinstance(request.get('revision'),int) or request['revision']<1: raise ValueError('invalid_revision')
    if type(request.get('outputFrom')) is not int or request['outputFrom']<0: raise ValueError('invalid_placement')
    # No tracking-parameter rewriting: signed/candidate URLs are not assumed equivalent.
    return digest({'scope':request['authorizationScope'],'url':url,'rights':rights,'interval':interval,'policy':policy})

def checked_policy(p):
    if set(p)!=set(LIMITS)|{'hosts'} or not isinstance(p['hosts'],list) or not 1<=len(p['hosts'])<=32: raise ValueError('invalid_policy')
    for h in p['hosts']: hostname(h)
    for k in LIMITS:
        if type(p[k]) is not int or p[k]<=0: raise ValueError('invalid_policy')
    # Trusted overrides are explicit policy changes, still bounded to this runtime.
    if p['trafficBytes']>512*1024**2 or p['assetBytes']>100*1024**2 or p['acquisitionSeconds']>300 or p['normalizeSeconds']>120 or p['connections']>128 or p['sourceSeconds']>1800 or p['coverageSeconds']>p['sourceSeconds']:
        raise ValueError('invalid_policy')
    return p

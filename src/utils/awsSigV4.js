import crypto from 'crypto';

function getSignatureKey(key, dateStamp, regionName, serviceName) {
  const kDate = crypto.createHmac('sha256', 'AWS4' + key).update(dateStamp).digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(regionName).digest();
  const kService = crypto.createHmac('sha256', kRegion).update(serviceName).digest();
  const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
  return kSigning;
}

export function signAwsV4(requestParams, credentials) {
  const { method, url, body, service, region } = requestParams;
  const { accessKeyId, secretAccessKey } = credentials;

  const endpoint = new URL(url);
  const host = endpoint.host;
  const canonicalUri = endpoint.pathname;
  
  const amzdate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const datestamp = amzdate.substring(0, 8); // YYYYMMDD

  const canonicalQuerystring = '';
  const payloadHash = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
  const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-date:${amzdate}\n`;
  const signedHeaders = 'content-type;host;x-amz-date';

  const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQuerystring}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  
  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${datestamp}/${region}/${service}/aws4_request`;
  const stringToSign = `${algorithm}\n${amzdate}\n${credentialScope}\n${crypto.createHash('sha256').update(canonicalRequest).digest('hex')}`;

  const signingKey = getSignatureKey(secretAccessKey, datestamp, region, service);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const authorizationHeader = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    'Content-Type': 'application/json',
    'X-Amz-Date': amzdate,
    'Authorization': authorizationHeader
  };
}

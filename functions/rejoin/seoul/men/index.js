// 기존 남성 참가자의 상시 할인 링크. 모집 중인 기수로 이동하며 src/utm을 보존한다.
import { entryHandler } from '../../../../shared/entry.mjs';
export const onRequestGet = entryHandler('/rejoin/seoul/men/');

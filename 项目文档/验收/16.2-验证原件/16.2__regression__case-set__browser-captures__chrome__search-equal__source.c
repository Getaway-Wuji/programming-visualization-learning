#include <stdio.h>
int main(void) {
    int n = 3;
    int values[3] = {2, 2, 2};
    int target = 2;
    int left = 0;
    int right = n - 1;
    int answer = -1;
    while (left <= right) {
        int mid = left + (right - left) / 2;
        if (values[mid] >= target) {
            if (values[mid] == target) {
                answer = mid;
            }
            right = mid - 1;
        } else {
            left = mid + 1;
        }
    }
    printf("%d\n", answer);
    return 0;
}

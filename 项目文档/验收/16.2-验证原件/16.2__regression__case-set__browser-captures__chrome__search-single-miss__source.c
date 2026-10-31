#include <stdio.h>
int main(void) {
    int n = 1;
    int values[1] = {-4};
    int target = 0;
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

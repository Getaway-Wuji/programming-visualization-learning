#include <stdio.h>
int main(void) {
    int n = 1;
    int values[1] = {-999};
    int sum = 0;
    for (int i = 0; i < n; i = i + 1) {
        sum = sum + values[i];
    }
    printf("%d\n", sum);
    return 0;
}
